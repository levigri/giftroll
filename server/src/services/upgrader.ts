import { prisma } from '../db/prisma.js'
import { findNftPrize } from '../data/cases.js'
import { GameError } from './game.js'
import { processWagering } from './deposit.js'
import { findActiveDepositLock } from './depositLock.js'
import { findNftCatalogEntry } from './nftPricing.js'
import { getTelegramMarketPrice } from './userbot.js'
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
  /** Целевой NFT при победе; при проигрыше null. */
  receivedNft: UpgraderNftView | null
  /** Сдача ⭐ после вычета стоимости выигранного NFT. */
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
 * При победе игрок получает целевой NFT, а сдача сверх цены NFT зачисляется ⭐.
 *
 * Цены NFT в ставке запрашиваются с Telegram Marketplace на сервере.
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
  const targetMarketPrice =
    (await getTelegramMarketPrice(targetNft.name)) ??
    findNftCatalogEntry(targetNft.name)?.price ??
    targetNft.price
  if (!targetMarketPrice || targetMarketPrice <= 0) {
    throw new GameError('NFT_PRICE_UNAVAILABLE', `Для «${targetNft.name}» нет актуальной цены на Telegram Marketplace`, 409)
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

  const quotedItems = uniqueIds.length
    ? await prisma.inventoryItem.findMany({
        where: { userId, id: { in: uniqueIds } },
        select: { id: true, prizeName: true, prizePrice: true },
      })
    : []
  const itemPriceEntries = await Promise.all(
    quotedItems.map(async (item) => {
      const marketPrice = await getTelegramMarketPrice(item.prizeName)
      return {
        id: item.id,
        price:
          marketPrice ??
          findNftCatalogEntry(item.prizeName)?.price ??
          item.prizePrice,
      }
    }),
  )
  const itemPrices = new Map(
    itemPriceEntries.flatMap(({ id, price }) => (price && price > 0 ? [[id, price] as const] : [])),
  )

  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем пользователя: баланс не уходит в минус, а инвентарь
      // не может быть одновременно сожжён двумя апгрейдами.
      const rows = await tx.$queryRaw<
        { id: bigint; balance: number; upgraderWinStreak: number; isBetaMode: boolean }[]
      >`
        SELECT id, balance, "upgraderWinStreak", "isBetaMode" FROM users WHERE id = ${userId} FOR UPDATE
      `
      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (!userRow.isBetaMode && userRow.balance < starsBet) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств для такой ставки', 400)
      }

      // В бета-режиме звёзды и NFT не списываются и не зачисляются,
      // поэтому для тестов применяем бонус к фактическому шансу.
      const displayedChance = chance
      const streak = userRow.upgraderWinStreak
      const debuff = Math.pow(0.94, Math.floor(streak / 3))
      const actualChance = userRow.isBetaMode
        ? Math.min(100, Math.max(50, displayedChance * 3))
        : Math.max(MIN_CHANCE, Math.round(displayedChance * debuff))
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

      const unavailable = items.find((item) => item.status !== 'PENDING')
      if (unavailable) {
        throw new GameError('NFT_UNAVAILABLE', `«${unavailable.prizeName}» уже закреплён за выводом или недоступен`, 409)
      }

      const unpriced = items.find((item) => (itemPrices.get(item.id) ?? 0) <= 0)
      if (unpriced) {
        throw new GameError('NFT_PRICE_UNAVAILABLE', `Для «${unpriced.prizeName}» пока не задана цена ставки`, 409)
      }
      const nftValue = items.reduce((sum, item) => sum + (itemPrices.get(item.id) ?? 0), 0)
      const totalBet = starsBet + nftValue

      if (totalBet < MIN_TOTAL_BET || totalBet > MAX_TOTAL_BET) {
        throw new GameError(
          'INVALID_BET',
          `Ставка должна быть от ${MIN_TOTAL_BET} до ${MAX_TOTAL_BET} ⭐`,
          400,
        )
      }

      const winAmount = win ? Math.floor(totalBet * multiplier) : 0
      if (!userRow.isBetaMode && win && winAmount < targetMarketPrice) {
        throw new GameError(
          'INVALID_BET',
          'Выплата меньше стоимости NFT. Увеличьте ставку или уменьшите шанс.',
          400,
        )
      }

      const grantNft = win && !userRow.isBetaMode
      const remainingStars = win && !userRow.isBetaMode ? winAmount - targetMarketPrice : 0
      const newBalance = userRow.isBetaMode ? userRow.balance : userRow.balance - starsBet + remainingStars

      // В бета-режиме тестовые ставки не уничтожают реальные NFT игрока.
      if (!userRow.isBetaMode && uniqueIds.length > 0) {
        const consumed = await tx.inventoryItem.deleteMany({
          where: { userId, id: { in: uniqueIds }, status: 'PENDING' },
        })
        if (consumed.count !== uniqueIds.length) {
          throw new GameError('NFT_UNAVAILABLE', 'Один из NFT уже используется другой операцией', 409)
        }
      }

      if (grantNft) {
        const inheritedLock = await findActiveDepositLock(tx, userId)
        await tx.inventoryItem.create({
          data: {
            userId,
            prizeId: targetNft.id,
            prizeName: targetNft.name,
            prizeEmoji: targetNft.emoji,
            prizePrice: targetMarketPrice,
            isExternal: false,
            lockUntil: inheritedLock,
            status: 'PENDING',
          },
        })
      }

      if (!userRow.isBetaMode) {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: newBalance,
            upgraderWinStreak: win ? { increment: 1 } : 0,
          },
        })
      }

      // История операций: ставка апгрейдера и (при победе) выигрыш.
      if (!userRow.isBetaMode) {
        await logTransaction(userId, 'UPGRADE', -starsBet, `Апгрейд: ${targetNft.name}`, tx)
        if (remainingStars > 0) {
          await logTransaction(userId, 'UPGRADE', remainingStars, 'Выигрыш в апгрейдере', tx)
        }
      }

      await tx.upgraderAttempt.create({
        data: {
          userId,
          targetNftId: targetNft.id,
          targetNftName: targetNft.name,
          targetNftEmoji: targetNft.emoji,
          targetNftPrice: targetMarketPrice,
          betAmount: totalBet,
          chance,
          win,
          winAmount: win ? winAmount : 0,
          isBetaMode: userRow.isBetaMode,
        },
      })

      const receivedNft = grantNft
        ? {
            id: targetNft.id,
            name: targetNft.name,
            emoji: targetNft.emoji,
            price: targetMarketPrice,
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
        isBetaMode: userRow.isBetaMode,
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
  if (!result.isBetaMode) {
    processWagering(userId, starsBet, 'upgrader').catch(console.error)
  }

  // При победе в апгрейдере всегда выдаётся NFT; в ленту звёзды не попадают.
  const feedItem = result.receivedNft
    ? {
        itemName: result.receivedNft.name,
        itemType: 'NFT' as const,
        itemEmoji: result.receivedNft.emoji,
        itemPrice: result.receivedNft.price,
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
