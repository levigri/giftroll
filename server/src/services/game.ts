import type { InventoryItem } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { depositBonusCase, findCase, type CaseItem, type Prize } from '../data/cases.js'
import { pickDailyBonusPrize, pickPrize } from '../utils/prize.js'
import { dailyBonusPrizes, type DailyBonusPrize } from '../data/dailyBonus.js'
import { getUsername, logDrop, type DropItemType } from './drops.js'
import { processWagering } from './deposit.js'
import { findActiveDepositLock } from './depositLock.js'
import { findNftCatalogEntry } from './nftPricing.js'
import { getTelegramMarketPrice } from './userbot.js'
import { isBotAccount } from '../utils/antiBot.js'
import { logTransaction } from './transaction.js'
import {
  balanceForCurrency,
  balanceUpdate,
  getCurrencyFactor,
  type GameCurrency,
  starsToCurrencyAmount,
} from '../utils/gameCurrency.js'

/** В ленте PrizeType 'BALANCE' — это звёздный дроп, остальное считаем NFT. */
function dropItemTypeOf(prize: Prize): DropItemType {
  return prize.type === 'NFT' ? 'NFT' : 'STARS'
}

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'GameError'
  }
}

/**
 * Серверное открытие кейса с блокировкой баланса пользователя (FOR UPDATE).
 * Выбор приза происходит строго на сервере.
 */
export async function openCase(
  userId: bigint,
  caseId: string,
  currency: GameCurrency = 'STARS',
): Promise<{ prize: Prize; newBalance: number; caseOpenId: string; currency: GameCurrency }> {
  const caseItem = findCase(caseId)
  if (!caseItem) {
    throw new GameError('CASE_NOT_FOUND', 'Кейс не найден', 404)
  }
  const currencyFactor = await getCurrencyFactor(currency)
  const casePrice = starsToCurrencyAmount(caseItem.price, currency, currencyFactor)
  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем запись пользователя для защиты от race condition
      const rows = await tx.$queryRaw<
        { id: bigint; balance: number; gramBalance: number; cryptoBalance: number; isBetaMode: boolean }[]
      >`
        SELECT id, balance, "gramBalance", "cryptoBalance", "isBetaMode" FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

      const currentBalance = balanceForCurrency(userRow, currency)
      const actualCasePrice = userRow.isBetaMode ? 0 : casePrice
      if (currentBalance < actualCasePrice) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400)
      }

      // Выбираем приз на сервере
      const prize = pickPrize(caseItem.prizes, userRow.isBetaMode ? 3 : 1)
      let newBalance: number

      if (prize.type === 'BALANCE') {
        const prizeAmount = starsToCurrencyAmount(prize.price, currency, currencyFactor)
        newBalance = userRow.isBetaMode ? currentBalance : currentBalance - actualCasePrice + prizeAmount
        if (!userRow.isBetaMode) {
          await tx.user.update({ where: { id: userId }, data: balanceUpdate(currency, newBalance) })
        }
      } else {
        newBalance = userRow.isBetaMode ? currentBalance : currentBalance - actualCasePrice
        if (!userRow.isBetaMode) {
          await tx.user.update({ where: { id: userId }, data: balanceUpdate(currency, newBalance) })
          const inheritedLock = currency === 'STARS' ? await findActiveDepositLock(tx, userId) : null
          await tx.inventoryItem.create({
            data: {
              userId,
              prizeId: prize.id,
              prizeName: prize.name,
              prizeEmoji: prize.emoji,
              prizePrice: prize.price,
              isExternal: false,
              lockUntil: inheritedLock,
              status: 'PENDING',
            },
          })
        }
      }

      const caseOpen = await tx.caseOpen.create({
        data: {
          userId,
          caseId: caseItem.id,
          prizeId: prize.id,
          prizeType: prize.type,
          prizePrice: starsToCurrencyAmount(prize.price, currency, currencyFactor),
          currency,
          casePrice: actualCasePrice,
          isBetaMode: userRow.isBetaMode,
        },
      })

      // История операций: расход на открытие кейса.
      if (!userRow.isBetaMode) {
        await logTransaction(
          userId,
          'CASE_OPEN',
          -actualCasePrice,
          `Кейс: ${caseItem.name} (${currency})`,
          tx,
          currency,
        )
      }

      return {
        prize,
        newBalance,
        caseOpenId: caseOpen.id,
        isBetaMode: userRow.isBetaMode,
      }
    },
    { timeout: 10000 },
  )

  // Отыгранная часть депозита уменьшается, реферер получает 10%.
  if (!result.isBetaMode && currency === 'STARS') {
    processWagering(userId, caseItem.price, 'case', caseItem.id).catch(console.error)
  }

  // Лента дропов: пишем после успешного открытия и не ждём БД.
  if (!result.isBetaMode) {
    const username = await getUsername(userId)
    logDrop({
      userId,
      username,
      eventType: 'case',
      itemName: result.prize.name,
      itemType: dropItemTypeOf(result.prize),
      itemEmoji: result.prize.emoji,
      itemPrice: result.prize.price,
      sourceName: caseItem.name,
      sourceEmoji: caseItem.emoji,
    }).catch(console.error)
  }

  return {
    prize: { ...result.prize, price: starsToCurrencyAmount(result.prize.price, currency, currencyFactor) },
    newBalance: result.newBalance,
    caseOpenId: result.caseOpenId,
    currency,
  }
}

export interface MultiCaseResultItem {
  prizeId: string
  name: string
  emoji: string
  type: 'BALANCE' | 'NFT'
  price: number
}

export interface MultiCaseOpenResult {
  results: MultiCaseResultItem[]
  totalValue: number
  spent: number
  /** Баланс выбранной валюты после списания и зачисления призов. */
  newBalance: number
  currency: GameCurrency
}

/**
 * Лента дропов для набора призов: username резолвим один раз на пачку.
 * Фильтра по цене нет: лента показывает все NFT, а звёздные дропы отсекает getFeed.
 */
function logCaseDrops(
  userId: bigint,
  prizes: Prize[],
  caseItem: CaseItem,
): void {
  if (prizes.length === 0) {
    return
  }

  void getUsername(userId)
    .then((username) =>
      Promise.all(
        prizes.map((prize) =>
          logDrop({
            userId,
            username,
            eventType: 'case',
            itemName: prize.name,
            itemType: dropItemTypeOf(prize),
            itemEmoji: prize.emoji,
            itemPrice: prize.price,
            sourceName: caseItem.name,
            sourceEmoji: caseItem.emoji,
          }),
        ),
      ),
    )
    .catch(console.error)
}

/**
 * Мульти-открытие кейса (×2 / ×5): одно списание, count независимых роллов
 * в одной транзакции. В инвентарь попадают только NFT, звёздные призы
 * сразу зачисляются на баланс.
 */
export async function openMultiCase(
  userId: bigint,
  caseId: string,
  count: 2 | 5,
  currency: GameCurrency = 'STARS',
): Promise<MultiCaseOpenResult> {
  if (count !== 2 && count !== 5) {
    throw new GameError('INVALID_COUNT', 'Можно открыть только 2 или 5 кейсов', 400)
  }

  const caseItem = findCase(caseId)
  if (!caseItem) {
    throw new GameError('CASE_NOT_FOUND', 'Кейс не найден', 404)
  }
  const currencyFactor = await getCurrencyFactor(currency)
  const nominalSpent = starsToCurrencyAmount(caseItem.price * count, currency, currencyFactor)

  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем строку пользователя: баланс не может уйти в минус.
      const rows = await tx.$queryRaw<
        { id: bigint; balance: number; gramBalance: number; cryptoBalance: number; isBetaMode: boolean }[]
      >`
        SELECT id, balance, "gramBalance", "cryptoBalance", "isBetaMode" FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

      const spent = userRow.isBetaMode ? 0 : nominalSpent
      const currentBalance = balanceForCurrency(userRow, currency)
      if (currentBalance < spent) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400)
      }

      const results: MultiCaseResultItem[] = []
      const prizes: Prize[] = []
      let starsWon = 0
      const inheritedLock =
        userRow.isBetaMode || currency !== 'STARS' ? null : await findActiveDepositLock(tx, userId)

      for (let index = 0; index < count; index += 1) {
        // Ролл независимый для каждого открытия.
        const prize = pickPrize(caseItem.prizes, userRow.isBetaMode ? 3 : 1)
        prizes.push(prize)

        if (prize.type === 'BALANCE') {
          if (!userRow.isBetaMode) {
            starsWon += starsToCurrencyAmount(prize.price, currency, currencyFactor)
          }
        } else if (!userRow.isBetaMode) {
          await tx.inventoryItem.create({
            data: {
              userId,
              prizeId: prize.id,
              prizeName: prize.name,
              prizeEmoji: prize.emoji,
              prizePrice: prize.price,
              isExternal: false,
              lockUntil: inheritedLock,
              status: 'PENDING',
            },
          })
        }

        await tx.caseOpen.create({
          data: {
            userId,
            caseId: caseItem.id,
            prizeId: prize.id,
            prizeType: prize.type,
            prizePrice: starsToCurrencyAmount(prize.price, currency, currencyFactor),
            currency,
            casePrice: userRow.isBetaMode
              ? 0
              : starsToCurrencyAmount(caseItem.price, currency, currencyFactor),
            isBetaMode: userRow.isBetaMode,
          },
        })

        results.push({
          prizeId: prize.id,
          name: prize.name,
          emoji: prize.emoji,
          type: prize.type,
          price: starsToCurrencyAmount(prize.price, currency, currencyFactor),
        })
      }

      // Одно обновление баланса на всю пачку: ставка списана, звёзды зачислены.
      const newBalance = userRow.isBetaMode ? currentBalance : currentBalance - spent + starsWon
      if (!userRow.isBetaMode) {
        await tx.user.update({ where: { id: userId }, data: balanceUpdate(currency, newBalance) })
      }

      // История операций: расход на пакетное открытие (price × count).
      if (!userRow.isBetaMode) {
        await logTransaction(userId, 'CASE_OPEN', -spent, `Кейс: ${caseItem.name} (${currency})`, tx, currency)
      }

      return { results, prizes, newBalance, spent, isBetaMode: userRow.isBetaMode }
    },
    { timeout: 10000 },
  )

  // Мульти-открытие — расход price × count (одно списание в транзакции).
  if (result.spent > 0 && currency === 'STARS') {
    processWagering(userId, result.spent, 'multi_case', caseItem.id).catch(console.error)
  }

  if (!result.isBetaMode) logCaseDrops(userId, result.prizes, caseItem)

  return {
    results: result.results,
    totalValue: result.results.reduce((sum, prize) => sum + prize.price, 0),
    spent: result.spent,
    newBalance: result.newBalance,
    currency,
  }
}

/**
 * Начисление ежедневного бонуса раз в 24 часа через взвешенную рулетку (10⭐, 20⭐, 50⭐).
 */
export async function claimDaily(userId: bigint): Promise<{
  prize: { id: string; label: string; emoji: string; amount: number; type: 'BALANCE' | 'NFT' }
  newBalance: number
  streak: number
}> {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000
  const TWO_DAYS_MS = 48 * 60 * 60 * 1000

  const userMode = await prisma.user.findUnique({ where: { id: userId }, select: { isBetaMode: true } })
  if (userMode?.isBetaMode) {
    throw new GameError('BETA_RESTRICTED', 'Ежедневные награды недоступны в бета-режиме', 403)
  }

  const now = new Date()
  const isSuspiciousAccount = await isBotAccount(userId)

  const result = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: bigint; balance: number; isBetaMode: boolean }[]>`
        SELECT id, balance, "isBetaMode" FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.isBetaMode) {
        throw new GameError('BETA_RESTRICTED', 'Ежедневные награды недоступны в бета-режиме', 403)
      }

      const existing = await tx.dailyBonus.findUnique({ where: { userId } })
      if (existing && now.getTime() - existing.lastClaimedAt.getTime() < ONE_DAY_MS) {
        throw new GameError('BONUS_NOT_READY', 'Бонус ещё не доступен', 400)
      }

      const completedDeposits = await tx.deposit.count({
        where: { userId, status: 'completed' },
      })

      let streak = 1
      if (existing) {
        const elapsed = now.getTime() - existing.lastClaimedAt.getTime()
        streak = elapsed > TWO_DAYS_MS ? 1 : existing.streak + 1
      }

      // Первый ежедневный бонус остаётся по обычной логике. Пока игрок не пополнял баланс,
      // каждый следующий ежедневный бонус гарантированно составляет 0.5 ⭐.
      const prize = existing && completedDeposits === 0
        ? { id: 'db-half', label: '0.5', emoji: '⭐', amount: 0.5, chance: 100, type: 'BALANCE' as const }
        : isSuspiciousAccount
          ? { id: 'db-1', label: '1', emoji: '⭐', amount: 1, chance: 100, type: 'BALANCE' as const }
          : pickDailyBonusPrize(dailyBonusPrizes)

      const nextBalance = userRow.balance + prize.amount

      await tx.user.update({
        where: { id: userId },
        data: { balance: nextBalance },
      })

      await tx.dailyBonus.upsert({
        where: { userId },
        update: {
          lastClaimedAt: now,
          streak,
        },
        create: {
          userId,
          lastClaimedAt: now,
          streak,
        },
      })

      // История операций: ежедневный бонус.
      await logTransaction(userId, 'DAILY_BONUS', prize.amount, 'Ежедневный бонус', tx)

      return { newBalance: nextBalance, streak, prize }
    },
    { timeout: 10000 },
  )

  console.log(`[DAILY] user=${userId} prize=${result.prize.id} amount=${result.prize.amount} streak=${result.streak}`)

  return {
    prize: {
      id: result.prize.id,
      label: result.prize.label,
      emoji: result.prize.emoji,
      amount: result.prize.amount,
      type: result.prize.type,
    },
    newBalance: result.newBalance,
    streak: result.streak,
  }
}

/** Бонусный кейс проверяет билет-флаг и сжигает его атомарно при выдаче приза. */
export async function claimFreeCase(userId: bigint): Promise<{
  prize: { id: string; label: string; emoji: string; amount: number; type: 'BALANCE' | 'NFT' }
  newBalance: number
}> {
  const won = pickPrize(depositBonusCase.prizes)
  const starsWon = won.type === 'BALANCE' ? won.price : 0

  const result = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{
        id: bigint
        balance: number
        hasClaimedDepositBonus: boolean
        isBetaMode: boolean
      }[]>`
        SELECT id, balance, "hasClaimedDepositBonus", "isBetaMode" FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.isBetaMode) {
        throw new GameError('BETA_RESTRICTED', 'Бонусный кейс недоступен в бета-режиме', 403)
      }
      if (userRow.hasClaimedDepositBonus) {
        throw new GameError(
          'ALREADY_CLAIMED',
          'Вы уже забирали бонус или у вас нет права на него',
          400,
        )
      }

      const nextBalance = userRow.balance + starsWon

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: nextBalance,
          // false — билет доступен, true — билет сожжён.
          hasClaimedDepositBonus: true,
          depositBonusOpened: true,
        },
      })

      // Выпавший NFT уходит в инвентарь (звёзды уже на балансе).
      if (won.type === 'NFT') {
        const inheritedLock = await findActiveDepositLock(tx, userId)
        await tx.inventoryItem.create({
          data: {
            userId,
            prizeId: won.id,
            prizeName: won.name,
            prizeEmoji: won.emoji,
            prizePrice: won.price,
            isExternal: false,
            lockUntil: inheritedLock,
            status: 'PENDING',
          },
        })
      } else {
        // История операций: бонусный кейс за депозит (только для звёзд).
        await logTransaction(
          userId,
          'DAILY_BONUS',
          starsWon,
          `Бонусный кейс за депозит: ${won.name}`,
          tx,
        )
      }

      return { newBalance: nextBalance }
    },
    { timeout: 10000 },
  )

  // Лента дропов: публикует NFT, звёздные дропы getFeed отсекает.
  logCaseDrops(userId, [won], depositBonusCase)

  console.log(
    `[FREE_CASE] user=${userId} prize=${won.id} type=${won.type} stars=${starsWon}`,
  )

  return {
    prize: {
      id: won.id,
      label: won.name,
      emoji: won.emoji,
      amount: starsWon,
      type: won.type,
    },
    newBalance: result.newBalance,
  }
}

/**
 * Получение инвентаря пользователя.
 */
export async function getInventory(userId: bigint): Promise<InventoryItem[]> {
  return prisma.inventoryItem.findMany({
    where: {
      userId,
      status: { not: 'CLAIMED' },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Продажа NFT за 95% от текущей минимальной цены коллекции на Telegram Marketplace.
 */
export async function sellNft(
  userId: bigint,
  itemId: string,
): Promise<{ newBalance: number; soldFor: number }> {
  const itemForQuote = await prisma.inventoryItem.findFirst({ where: { id: itemId, userId } })
  if (!itemForQuote) {
    throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
  }
  const marketPrice =
    (await getTelegramMarketPrice(itemForQuote.prizeName)) ??
    findNftCatalogEntry(itemForQuote.prizeName)?.price ??
    itemForQuote.prizePrice
  if (!marketPrice || marketPrice <= 0) {
    throw new GameError('NFT_PRICE_UNAVAILABLE', 'Не удалось получить актуальную цену подарка с маркета Telegram. Продажа временно недоступна.', 409)
  }

  return prisma.$transaction(
    async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, userId },
      })

      if (!item) {
        throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
      }

      if (item.status !== 'PENDING') {
        throw new GameError('ITEM_UNAVAILABLE', 'Предмет уже закреплён за выводом или недоступен', 409)
      }

      if (!item.isExternal && item.lockUntil && item.lockUntil > new Date()) {
        const daysLeft = Math.ceil((item.lockUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        throw new GameError('NFT_LOCKED', `Продажа заблокирована. Осталось дней: ${daysLeft}`)
      }

      const soldFor = Math.floor(marketPrice * 0.95)

      const deleted = await tx.inventoryItem.deleteMany({
        where: { id: itemId, userId, status: 'PENDING' },
      })
      if (deleted.count !== 1) {
        throw new GameError('ITEM_UNAVAILABLE', 'Предмет уже используется другой операцией', 409)
      }

      // Блокируем строку пользователя и зачисляем звёзды
      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

      const newBalance = userRow.balance + soldFor

      await tx.user.update({
        where: { id: userId },
        data: { balance: newBalance },
      })

      // История операций: зачисление за проданное NFT.
      await logTransaction(userId, 'SELL_NFT', soldFor, `Продажа: ${item.prizeName}`, tx)

      return {
        newBalance,
        soldFor,
      }
    },
    { timeout: 10000 },
  )
}

/** Не подтверждаем вывод до подключения реального механизма отправки подарка. */
export async function requestNftClaim(
  userId: bigint,
  itemId: string,
): Promise<{ status: string }> {
  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, userId } })
  if (!item) {
    throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
  }
  if (item.status === 'CLAIMED') {
    throw new GameError('ALREADY_CLAIMED', 'Предмет уже выведен', 400)
  }

  throw new GameError(
    'WITHDRAWAL_NOT_CONFIGURED',
    'Вывод подарков ещё не подключён. Предмет остался в инвентаре.',
    503,
  )
}
