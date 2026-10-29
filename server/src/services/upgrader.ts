import { prisma } from '../db/prisma.js'
import { findNftPrize } from '../data/cases.js'
import { GameError } from './game.js'
import { processWagering } from './deposit.js'
import { findActiveDepositLock } from './depositLock.js'
import { getUsername, logDrop } from './drops.js'
import { logTransaction } from './transaction.js'

/**
 * Апгрейдер: игрок ставит ⭐ + NFT и выбирает шанс.
 * Множитель = 95 / chance, поэтому матожидание всегда 95% от ставки.
 */

/** Границы суммарной ставки (⭐ + NFT). */
export const MIN_TOTAL_BET = 10
export const MAX_TOTAL_BET = 25_000

/** Границы шанса победы в процентах. */
export const MIN_CHANCE = 1
export const MAX_CHANCE = 80

/** Возврат при 100% шансе — база для множителя. */
export const PAYOUT_PERCENT = 95

/** Выигрыш от этой суммы попадает в публичную ленту. */
export const FEED_MIN_WIN = 5000

/** Сколько NFT можно положить в одну ставку (защита от гигантских запросов). */
export const MAX_NFT_IDS = 50

export interface UpgraderNftView {
  id: string
  name: string
  emoji: string
  price: number
}

export interface UpgradeResult {
  win: boolean
  /** Выплата при победе (ставка × множитель); при проигрыше — 0. */
  winAmount: number
  multiplier: number
  totalBet: number
  /** Целевой NFT, если выплаты хватило на него; иначе null. */
  receivedNft: UpgraderNftView | null
  /** Сколько ⭐ зачислено на баланс: вся выплата или сдача после NFT. */
  remainingStars: number
}

/** Множитель для шанса: 1% → x95, 10% → x9.5, 50% → x1.9. */
export function multiplierOf(chance: number): number {
  return PAYOUT_PERCENT / chance
}

function assertChance(chance: number): void {
  if (!Number.isFinite(chance) || chance < MIN_CHANCE || chance > MAX_CHANCE) {
    throw new GameError(
      'INVALID_CHANCE',
      `Шанс должен быть от ${MIN_CHANCE}% до ${MAX_CHANCE}%`,
      400,
    )
  }
}

/**
 * Проводит апгрейд: списывает ⭐, сжигает выбранные NFT, при победе начисляет выплату.
 *
 * Выплата идёт на целевой NFT из cases.ts: если её хватает на предмет, он падает
 * в инвентарь, а разница уходит на баланс. Если не хватает — вся выплата идёт ⭐.
 *
 * Цена NFT в ставке берётся из InventoryItem.prizePrice — это серверный снимок
 * цены из cases.ts на момент выпадения, поэтому клиент не может завысить стоимость.
 */
export async function performUpgrade(
  userId: bigint,
  nftIds: string[],
  starsBet: number,
  chance: number,
  targetNftId: string,
): Promise<UpgradeResult> {
  assertChance(chance)

  const targetNft = findNftPrize(targetNftId.trim())
  if (!targetNft) {
    throw new GameError('TARGET_NOT_FOUND', 'Целевой предмет не найден', 404)
  }

  if (!Number.isInteger(starsBet) || starsBet < 0) {
    throw new GameError('INVALID_BET', 'Ставка в ⭐ должна быть целым неотрицательным числом', 400)
  }

  const uniqueIds = [...new Set(nftIds.map((id) => id.trim()).filter(Boolean))]
  if (uniqueIds.length > MAX_NFT_IDS) {
    throw new GameError('TOO_MANY_NFT', `За один апгрейд можно поставить не больше ${MAX_NFT_IDS} NFT`, 400)
  }
  if (uniqueIds.length !== nftIds.length) {
    throw new GameError('INVALID_NFT', 'Список NFT содержит повторы или пустые id', 400)
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем пользователя: баланс не уходит в минус, а инвентарь
      // не может быть одновременно сожжён двумя апгрейдами.
      const rows = await tx.$queryRaw<
        { id: bigint; balance: number; upgraderWinStreak: number }[]
      >`
        SELECT id, balance, "upgraderWinStreak" FROM users WHERE id = ${userId} FOR UPDATE
      `
      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.balance < starsBet) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств для такой ставки', 400)
      }

      // Игрок видит displayedChance и множитель от неё: выплата при победе
      // ровно такая, как ожидалась. Реальный шанс тихо падает с серией побед.
      const displayedChance = chance
      const streak = userRow.upgraderWinStreak
      const debuff = Math.pow(0.94, Math.floor(streak / 3))
      const actualChance = Math.max(MIN_CHANCE, Math.round(displayedChance * debuff))
      const multiplier = multiplierOf(displayedChance)
      const win = Math.random() * 100 < actualChance

      const items = uniqueIds.length
        ? await tx.inventoryItem.findMany({
            where: { userId, id: { in: uniqueIds } },
          })
        : []

      if (items.length !== uniqueIds.length) {
        throw new GameError('NFT_NOT_FOUND', 'Один из выбранных NFT не найден в инвентаре', 400)
      }

      const claimed = items.find((item) => item.status === 'CLAIMED')
      if (claimed) {
        throw new GameError('NFT_CLAIMED', `«${claimed.prizeName}» уже выведен и не участвует`, 400)
      }

      const nftValue = items.reduce((sum, item) => sum + item.prizePrice, 0)
      const totalBet = starsBet + nftValue

      if (totalBet < MIN_TOTAL_BET || totalBet > MAX_TOTAL_BET) {
        throw new GameError(
          'INVALID_BET',
          `Ставка должна быть от ${MIN_TOTAL_BET} до ${MAX_TOTAL_BET} ⭐`,
          400,
        )
      }

      const winAmount = win ? Math.floor(totalBet * multiplier) : 0
      // Выплаты хватает на целевой NFT — забираем предмет, остаток идёт ⭐.
      const grantNft = win && winAmount >= targetNft.price
      const remainingStars = win ? (grantNft ? winAmount - targetNft.price : winAmount) : 0
      const newBalance = userRow.balance - starsBet + remainingStars

      // NFT сгорают в любом случае — и при победе, и при проигрыше.
      if (uniqueIds.length > 0) {
        await tx.inventoryItem.deleteMany({
          where: { userId, id: { in: uniqueIds } },
        })
      }

      if (grantNft) {
        const inheritedLock = await findActiveDepositLock(tx, userId)
        await tx.inventoryItem.create({
          data: {
            userId,
            prizeId: targetNft.id,
            prizeName: targetNft.name,
            prizeEmoji: targetNft.emoji,
            prizePrice: targetNft.price,
            isExternal: false,
            lockUntil: inheritedLock,
            status: 'PENDING',
          },
        })
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: newBalance,
          upgraderWinStreak: win ? { increment: 1 } : 0,
        },
      })

      // История операций: ставка апгрейдера и (при победе) выигрыш.
      await logTransaction(userId, 'UPGRADE', -starsBet, `Апгрейд: ${targetNft.name}`, tx)
      if (remainingStars > 0) {
        await logTransaction(userId, 'UPGRADE', remainingStars, 'Выигрыш в апгрейдере', tx)
      }

      const receivedNft = grantNft
        ? {
            id: targetNft.id,
            name: targetNft.name,
            emoji: targetNft.emoji,
            price: targetNft.price,
          }
        : null

      return {
        win,
        winAmount,
        multiplier,
        totalBet,
        receivedNft,
        remainingStars,
        /** Только для внутренних логов: на фронт не уходит. */
        actualChance,
        streak,
      }
    },
    { timeout: 10000 },
  )

  console.log(
    `[UPGRADER] user=${userId} total=${result.totalBet} chance=${chance}% ` +
      `actual=${result.actualChance}% streak=${result.streak} ` +
      `multiplier=${result.multiplier.toFixed(2)} target=${targetNft.id} win=${result.win} ` +
      `payout=${result.winAmount} nft=${result.receivedNft?.id ?? 'none'} ` +
      `stars=${result.remainingStars}`,
  )

  // Списанные ⭐ отыгрывают депозит и приносят рефереру 10%.
  processWagering(userId, starsBet, 'upgrader').catch(console.error)

  // Выигранный NFT показываем в ленте всегда, крупный звёздный выигрыш — от FEED_MIN_WIN.
  const feedItem = result.receivedNft
    ? {
        itemName: result.receivedNft.name,
        itemType: 'NFT' as const,
        itemEmoji: result.receivedNft.emoji,
        itemPrice: result.receivedNft.price,
      }
    : result.win && result.remainingStars >= FEED_MIN_WIN
      ? {
          itemName: `Апгрейд ×${result.multiplier.toFixed(2)}`,
          itemType: 'STARS' as const,
          itemEmoji: '⭐',
          itemPrice: result.remainingStars,
        }
      : null

  if (feedItem) {
    void getUsername(userId)
      .then((username) =>
        logDrop({
          userId,
          username,
          eventType: 'upgrader',
          sourceName: 'Апгрейдер',
          sourceEmoji: '🔮',
          ...feedItem,
        }),
      )
      .catch((error: unknown) => {
        console.error('[UPGRADER] logDrop failed:', error)
      })
  }

  // Наружу отдаём только публичные поля: actualChance и streak остаются внутри.
  return {
    win: result.win,
    winAmount: result.winAmount,
    multiplier: result.multiplier,
    totalBet: result.totalBet,
    receivedNft: result.receivedNft,
    remainingStars: result.remainingStars,
  }
}
