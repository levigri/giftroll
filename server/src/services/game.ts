import type { InventoryItem } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { depositBonusCase, findCase, type CaseItem, type Prize } from '../data/cases.js'
import { pickDailyBonusPrize, pickPrize } from '../utils/prize.js'
import { dailyBonusPrizes, type DailyBonusPrize } from '../data/dailyBonus.js'
import { getUsername, logDrop, type DropItemType } from './drops.js'
import { processWagering } from './deposit.js'
import { findActiveDepositLock } from './depositLock.js'
import { logTransaction } from './transaction.js'

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
): Promise<{ prize: Prize; newBalance: number; caseOpenId: string }> {
  const caseItem = findCase(caseId)
  if (!caseItem) {
    throw new GameError('CASE_NOT_FOUND', 'Кейс не найден', 404)
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем запись пользователя для защиты от race condition
      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

      const currentBalance = userRow.balance
      if (currentBalance < caseItem.price) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400)
      }

      // Выбираем приз на сервере
      const prize = pickPrize(caseItem.prizes)
      let newBalance: number

      if (prize.type === 'BALANCE') {
        newBalance = currentBalance - caseItem.price + prize.price
        await tx.user.update({
          where: { id: userId },
          data: { balance: newBalance },
        })
      } else {
        newBalance = currentBalance - caseItem.price
        await tx.user.update({
          where: { id: userId },
          data: { balance: newBalance },
        })
        const inheritedLock = await findActiveDepositLock(tx, userId)
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

      const caseOpen = await tx.caseOpen.create({
        data: {
          userId,
          caseId: caseItem.id,
          prizeId: prize.id,
          prizeType: prize.type,
          prizePrice: prize.price,
        },
      })

      // История операций: расход на открытие кейса.
      await logTransaction(userId, 'CASE_OPEN', -caseItem.price, `Кейс: ${caseItem.name}`, tx)

      return {
        prize,
        newBalance,
        caseOpenId: caseOpen.id,
      }
    },
    { timeout: 10000 },
  )

  // Отыгранная часть депозита уменьшается, реферер получает 10%.
  processWagering(userId, caseItem.price, 'case', caseItem.id).catch(console.error)

  // Лента дропов: пишем после успешного открытия и не ждём БД.
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

  return result
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
  /** Баланс после списания ставки и зачисления всех звёздных призов. */
  newBalance: number
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
): Promise<MultiCaseOpenResult> {
  if (count !== 2 && count !== 5) {
    throw new GameError('INVALID_COUNT', 'Можно открыть только 2 или 5 кейсов', 400)
  }

  const caseItem = findCase(caseId)
  if (!caseItem) {
    throw new GameError('CASE_NOT_FOUND', 'Кейс не найден', 404)
  }

  const spent = caseItem.price * count

  const result = await prisma.$transaction(
    async (tx) => {
      // Блокируем строку пользователя: баланс не может уйти в минус.
      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

      if (userRow.balance < spent) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400)
      }

      const results: MultiCaseResultItem[] = []
      const prizes: Prize[] = []
      let starsWon = 0
      const inheritedLock = await findActiveDepositLock(tx, userId)

      for (let index = 0; index < count; index += 1) {
        // Ролл независимый для каждого открытия.
        const prize = pickPrize(caseItem.prizes)
        prizes.push(prize)

        if (prize.type === 'BALANCE') {
          // Звёзды сразу на баланс — предметом в инвентарь они не попадают.
          starsWon += prize.price
        } else {
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
            prizePrice: prize.price,
          },
        })

        results.push({
          prizeId: prize.id,
          name: prize.name,
          emoji: prize.emoji,
          type: prize.type,
          price: prize.price,
        })
      }

      // Одно обновление баланса на всю пачку: ставка списана, звёзды зачислены.
      const newBalance = userRow.balance - spent + starsWon
      await tx.user.update({
        where: { id: userId },
        data: { balance: newBalance },
      })

      // История операций: расход на пакетное открытие (price × count).
      await logTransaction(userId, 'CASE_OPEN', -spent, `Кейс: ${caseItem.name}`, tx)

      return { results, prizes, newBalance }
    },
    { timeout: 10000 },
  )

  // Мульти-открытие — расход price × count (одно списание в транзакции).
  processWagering(userId, spent, 'multi_case', caseItem.id).catch(console.error)

  logCaseDrops(userId, result.prizes, caseItem)

  return {
    results: result.results,
    totalValue: result.results.reduce((sum, prize) => sum + prize.price, 0),
    spent,
    newBalance: result.newBalance,
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

  const existing = await prisma.dailyBonus.findUnique({
    where: { userId },
  })

  const now = new Date()

  if (existing && now.getTime() - existing.lastClaimedAt.getTime() < ONE_DAY_MS) {
    throw new GameError('BONUS_NOT_READY', 'Бонус ещё не доступен', 400)
  }

  let streak = 1
  if (existing) {
    const elapsed = now.getTime() - existing.lastClaimedAt.getTime()
    if (elapsed > TWO_DAYS_MS) {
      streak = 1 // Стрик сбросился
    } else {
      streak = existing.streak + 1
    }
  }

  const prize = pickDailyBonusPrize(dailyBonusPrizes)

  const newBalance = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }

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

      return nextBalance
    },
    { timeout: 10000 },
  )

  console.log(`[DAILY] user=${userId} prize=${prize.id} amount=${prize.amount} streak=${streak}`)

  return {
    prize: {
      id: prize.id,
      label: prize.label,
      emoji: prize.emoji,
      amount: prize.amount,
      type: prize.type,
    },
    newBalance,
    streak,
  }
}

/**
 * Бонусный кейс за депозит от 200 ⭐: атомарно списывает одну единицу freeCases
 * и выигрывает приз из пула `depositBonusCase` (10/20/50 ⭐ и редкие NFT 0.1%).
 */
export async function claimFreeCase(userId: bigint): Promise<{
  prize: { id: string; label: string; emoji: string; amount: number; type: 'BALANCE' | 'NFT' }
  newBalance: number
  freeCasesLeft: number
}> {
  const won = pickPrize(depositBonusCase.prizes)
  const starsWon = won.type === 'BALANCE' ? won.price : 0

  const result = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{
        id: bigint
        balance: number
        freeCases: number
      }[]>`
        SELECT id, balance, "freeCases" FROM users WHERE id = ${userId} FOR UPDATE
      `

      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.freeCases <= 0) {
        throw new GameError('NO_FREE_CASE', 'Кейс доступен после пополнения от 200 ⭐', 400)
      }

      const nextBalance = userRow.balance + starsWon

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: nextBalance,
          freeCases: { decrement: 1 },
          // Кейс за депозит одноразовый: карточка в сетке больше не показывается.
          hasClaimedDepositBonus: true,
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

      return { newBalance: nextBalance, freeCasesLeft: userRow.freeCases - 1 }
    },
    { timeout: 10000 },
  )

  // Лента дропов: публикует NFT, звёздные дропы getFeed отсекает.
  logCaseDrops(userId, [won], depositBonusCase)

  console.log(
    `[FREE_CASE] user=${userId} prize=${won.id} type=${won.type} stars=${starsWon} left=${result.freeCasesLeft}`,
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
    freeCasesLeft: result.freeCasesLeft,
  }
}

/**
 * Получение инвентаря пользователя.
 */
export async function getInventory(userId: bigint): Promise<InventoryItem[]> {
  return prisma.inventoryItem.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Продажа NFT за 95% от номинальной стоимости звёзд.
 */
export async function sellNft(
  userId: bigint,
  itemId: string,
): Promise<{ newBalance: number; soldFor: number }> {
  return prisma.$transaction(
    async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, userId },
      })

      if (!item) {
        throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
      }

      if (item.status === 'CLAIMED') {
        throw new GameError('ALREADY_CLAIMED', 'Предмет уже выведен', 400)
      }

      if (!item.isExternal && item.lockUntil && item.lockUntil > new Date()) {
        const daysLeft = Math.ceil((item.lockUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        throw new GameError('NFT_LOCKED', `Продажа заблокирована. Осталось дней: ${daysLeft}`)
      }

      const soldFor = Math.floor(item.prizePrice * 0.95)

      // Удаляем предмет внутри транзакции
      try {
        await tx.inventoryItem.delete({
          where: { id: itemId },
        })
      } catch (err: unknown) {
        const prismaErr = err as { code?: string }
        if (prismaErr?.code === 'P2025') {
          throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
        }
        throw err
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
