import { convertFromGramjsSession } from '@mtcute/convert'
import { MemoryStorage, TelegramClient, type Message, type SavedStarGift } from '@mtcute/node'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { notifyUser } from './bot.js'
import { findNftCatalogEntry } from './nftPricing.js'

let userbot: TelegramClient | null = null
let isUserbotStarted = false
let marketPriceCache: { expiresAt: number; prices: Map<string, number> } | null = null
let marketPriceRequest: Promise<Map<string, number> | null> | null = null
let marketPricePauseUntil = 0
let pendingWithdrawalRetryRunning = false
const giftTransfersInProgress = new Set<string>()

export class UserbotTransferError extends Error {
  constructor(public readonly code: 'STARS_INSUFFICIENT', message: string) {
    super(message)
    this.name = 'UserbotTransferError'
  }
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`
  return String(error)
}

function isInsufficientRelayerStarsError(error: unknown): boolean {
  const details = [getErrorText(error)]
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    for (const key of ['code', 'text', 'errorMessage']) {
      const value = record[key]
      if (typeof value === 'string') details.push(value)
    }
  }
  return /STARS?_INSUFFICIENT|BALANCE_TOO_LOW|NOT_ENOUGH_STARS|INSUFFICIENT_(?:BALANCE|STARS)|STARGIFT_TRANSFER_UNAVAILABLE|GIFT_TRANSFER_FORBIDDEN/i.test(
    details.join(' '),
  )
}

function getMarketPriceRetryDelay(error: unknown): number {
  const errorText = getErrorText(error)
  const floodWait = errorText.match(/FLOOD_WAIT[_\s:]*(\d+)/i)
  if (floodWait?.[1]) return Number(floodWait[1]) * 1000
  if (/timeout|timed out|ETIMEDOUT/i.test(errorText)) return 2_000
  return 0
}

function registerMarketPriceBackoff(error: unknown): void {
  const delay = getMarketPriceRetryDelay(error)
  if (delay <= 0) return
  marketPricePauseUntil = Math.max(marketPricePauseUntil, Date.now() + delay)
  console.warn(`[Userbot] Пауза запросов цен на ${Math.ceil(delay / 1000)} сек. из-за лимита/таймаута Telegram`)
}

async function waitForMarketPriceBackoff(): Promise<void> {
  while (marketPricePauseUntil > Date.now()) {
    const delay = marketPricePauseUntil - Date.now()
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
  }
}

function normalizeGiftName(name: string): string {
  return name.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function positivePrice(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return null
  const price = Number(value)
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

function positiveAveragePrice(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return null
  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null
}

function optionalAveragePrice(gift: object): number | null {
  const giftRecord = gift as unknown as Record<string, unknown>
  const raw = giftRecord.raw
  const rawRecord = typeof raw === 'object' && raw !== null
    ? raw as Record<string, unknown>
    : null
  const possibleValues = [
    giftRecord.averagePrice,
    giftRecord.average_price,
    giftRecord.avgPrice,
    rawRecord?.averagePrice,
    rawRecord?.average_price,
    rawRecord?.avgPrice,
  ]
  for (const value of possibleValues) {
    const price = positiveAveragePrice(value)
    if (price !== null) return price
  }
  return null
}

type UniqueGiftLike = { id: { toString(): string }; title: string; isUnique: true }

function isUniqueGift(value: unknown): value is UniqueGiftLike {
  return Boolean(
    value && typeof value === 'object' && 'isUnique' in value && value.isUnique === true &&
    'id' in value && 'title' in value && typeof value.title === 'string',
  )
}

async function handleIncomingMessage(message: Message): Promise<void> {
  if (message.isOutgoing) return

  console.info(`[Userbot-DEBUG] Пришло сообщение: ID=${message.id}, isService=${message.isService}, chatType=${message.chat.type}, action=${message.action?.type ?? 'none'}, text=${message.text?.slice(0, 50) ?? 'none'}`)

  if (!message.isService || message.chat.type !== 'user') return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const action = message.action as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let giftToProcess: any = null

  if (action) {
    if (action.type === 'star_gift_transferred' && 'gift' in action) {
      giftToProcess = action.gift
    } else if (action.type === 'star_gift_sent' && 'gift' in action) {
      giftToProcess = action.gift
    } else if ('gift' in action && action.gift) {
      giftToProcess = action.gift
    }
  }

  if (!giftToProcess) {
    console.info(`[Userbot] Событие ${action?.type} не содержит подарка. Игнорируем.`)
    return
  }

  if ('refunded' in action && action.refunded) {
    console.info(`[Userbot] NFT-подарок в сообщении ${message.id} возвращён. Игнорируем.`)
    return
  }

  const senderId = message.sender?.id
  if (!senderId) {
    console.warn(`[Userbot] Подарок в сообщении ${message.id} не имеет отправителя.`)
    return
  }
  const peerId = message.chat.id
  const senderUserId = BigInt(senderId)
  const giftId = giftToProcess.id?.toString() || `unknown-${message.id}`
  const rawPrizeName = giftToProcess.title || (giftToProcess.gift?.title) || `Telegram NFT #${giftId}`
  const catalogEntry = findNftCatalogEntry(rawPrizeName)
  const prizeName = catalogEntry?.name ?? rawPrizeName

  console.info(`[Userbot] Пойман NFT-подарок! ${JSON.stringify({
    id: message.id,
    peerId,
    senderId,
    giftId,
    title: rawPrizeName,
    action: action?.type,
  }).slice(0, 2000)}`)

  const user = await prisma.user.findUnique({ where: { id: senderUserId } })
  if (!user) {
    console.info(`[Userbot] NFT в сообщении ${message.id}: Telegram-пользователь не найден в GiftRoll`)
    return
  }

  try {
    await prisma.$transaction(async (tx) => {
      const inventoryItem = await tx.inventoryItem.create({
        data: {
          userId: user.id,
          prizeId: catalogEntry?.id ?? `telegram-gift:${peerId}:${message.id}`,
          prizeName,
          prizeEmoji: catalogEntry?.emoji ?? '🎁',
          prizePrice: catalogEntry?.price ?? 0,
          giftId,
          isExternal: true,
          lockUntil: null,
        },
      })

      await tx.telegramGiftReceipt.create({
        data: {
          peerId: String(peerId),
          messageId: message.id,
          senderUserId,
          inventoryItemId: inventoryItem.id,
        },
      })
    })

    console.info(`[Userbot] Telegram NFT #${giftId} зачислен в инвентарь GiftRoll`)
    await notifyUser(senderUserId, `✅ Твой подарок «${prizeName}» успешно зачислен в инвентарь GiftRoll!`)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      console.info(`[Userbot] Повторное событие подарка пропущено (message ${message.id})`)
      return
    }
    console.error('[Userbot] Не удалось зачислить Telegram NFT:', error)
  }
}

async function getMarketPrices(forceRefresh = false): Promise<Map<string, number> | null> {
  if (!forceRefresh && marketPriceCache && marketPriceCache.expiresAt > Date.now()) {
    return marketPriceCache.prices
  }
  if (marketPriceRequest) return marketPriceRequest
  const client = userbot
  if (!client || !isUserbotStarted) return null

  marketPriceRequest = (async () => {
    try {
      await waitForMarketPriceBackoff()
      const gifts = await client.getStarGiftOptions()
      const prices = new Map<string, number>()
      const catalogNames = new Set(nftCatalog.map((gift) => normalizeGiftName(gift.name)))
      for (const gift of gifts) {
        const title = gift.title
        if (!title || !catalogNames.has(normalizeGiftName(title))) continue

        const floorPrice = positivePrice(gift.resaleFloorPrice?.toString())
        const price = floorPrice ?? optionalAveragePrice(gift)
        if (price !== null) prices.set(normalizeGiftName(title), price)
      }

      marketPriceCache = { prices, expiresAt: Date.now() + 60_000 }
      return prices
    } catch (error) {
      registerMarketPriceBackoff(error)
      console.warn('[Userbot] Не удалось получить официальные floor prices Telegram:', error)
      return null
    } finally {
      marketPriceRequest = null
    }
  })()
  return marketPriceRequest
}

/** Fallback: current minimum Stars listing for the Telegram gift collection. */
export async function getTelegramMarketPrice(prizeName: string): Promise<number | null> {
  const prices = await getMarketPrices()
  return prices?.get(normalizeGiftName(prizeName)) ?? null
}

/** Forces a single fresh Telegram gift catalog read for the price synchronizer. */
export async function refreshTelegramMarketPrices(): Promise<Map<string, number> | null> {
  return getMarketPrices(true)
}

/** Returns Telegram's Stars rating value when available; MTProto failures are non-fatal. */
export async function getTelegramStarsRating(userId: bigint): Promise<number | null> {
  const client = userbot
  if (!client || !isUserbotStarted) return null

  try {
    const fullUser = await client.getFullUser(userId.toString())
    const rawRating = fullUser.starsRating?.stars
    if (rawRating === undefined || rawRating === null) return null

    const rating = Number(rawRating.toString())
    return Number.isFinite(rating) ? rating : null
  } catch (error) {
    console.warn(`[Userbot] Не удалось получить Stars rating для ${userId}:`, error)
    return null
  }
}

async function listRelayerGifts(client: TelegramClient): Promise<SavedStarGift[]> {
  const gifts: SavedStarGift[] = []
  let offset: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = await client.getSavedStarGifts({ owner: 'me', offset, limit: 100 })
    gifts.push(...result)
    if (!result.next) break
    offset = result.next
  }
  return gifts
}

async function findAvailableRelayerGift(itemId: string, userId: bigint): Promise<SavedStarGift | null> {
  const client = userbot
  if (!client || !isUserbotStarted) return null
  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, userId } })
  if (!item) return null

  if (item.isExternal && item.giftId) {
    const receipt = await prisma.telegramGiftReceipt.findFirst({ where: { inventoryItemId: item.id } })
    if (!receipt) return null
  }

  const savedGifts = await listRelayerGifts(client)
  const matching = savedGifts.filter((entry): entry is SavedStarGift & { gift: UniqueGiftLike } => {
    if (!isUniqueGift(entry.gift)) return false
    return item.giftId
      ? entry.gift.id.toString() === item.giftId
      : normalizeGiftName(entry.gift.title) === normalizeGiftName(item.prizeName)
  })
  if (matching.length === 0) return null

  // Do not treat gifts currently assigned to another player's inventory as free.
  const giftIds = matching.map((entry) => entry.gift.id.toString())
  const assigned = await prisma.inventoryItem.findMany({
    where: {
      giftId: { in: giftIds },
      id: { not: item.id },
      status: { in: ['PENDING', 'WITHDRAWAL_REQUESTED'] },
    },
    select: { giftId: true },
  })
  const assignedIds = new Set(assigned.flatMap((row) => row.giftId ? [row.giftId] : []))
  const available = matching.find((entry) => !assignedIds.has(entry.gift.id.toString()))
  if (!available) return null

  // Pin a real Telegram gift to this player's inventory row before issuing an
  // invoice. The unique giftId index prevents concurrent claims from reserving it twice.
  if (!item.giftId) {
    const assignedGift = await prisma.inventoryItem.updateMany({
      where: {
        id: item.id,
        userId,
        status: { in: ['PENDING', 'WITHDRAWAL_REQUESTED'] },
        giftId: null,
      },
      data: { giftId: available.gift.id.toString() },
    })
    if (assignedGift.count !== 1) return null
  }
  return available
}

export async function hasAvailableRelayerGift(
  itemId: string,
  userId: bigint,
): Promise<{ available: boolean; code?: string; message?: string }> {
  if (!userbot || !isUserbotStarted) {
    return { available: false, code: 'RELAYER_UNAVAILABLE', message: 'Аккаунт релаера временно недоступен. Попробуйте позже.' }
  }
  try {
    const gift = await findAvailableRelayerGift(itemId, userId)
    return gift
      ? { available: true }
      : { available: false, code: 'GIFT_NOT_AVAILABLE', message: 'На аккаунте релаера сейчас нет такого подарка. Попробуйте позже или обратитесь в поддержку.' }
  } catch (error) {
    console.error('[Userbot] Не удалось проверить наличие подарка у релаера:', error)
    return { available: false, code: 'RELAYER_CHECK_FAILED', message: 'Не удалось проверить подарки релаера. Попробуйте позже.' }
  }
}

/** Transfers the exact external NFT or an unassigned matching gift from Relayer's Telegram inventory. */
export async function sendSavedGiftToUser(itemId: string, userId: bigint): Promise<boolean> {
  const client = userbot
  if (!client || !isUserbotStarted || giftTransfersInProgress.has(itemId)) return false
  giftTransfersInProgress.add(itemId)

  try {
    const gift = await findAvailableRelayerGift(itemId, userId)
    if (!gift || !isUniqueGift(gift.gift)) return false
    const giftInput = gift.savedId
      ? { owner: 'me' as const, savedId: gift.savedId }
      : gift.messageId
        ? { message: gift.messageId }
        : null
    if (!giftInput) return false

    await client.transferStarGift({
      gift: giftInput,
      recipient: Number(userId),
    })
    console.info(`[Userbot] NFT for inventory item ${itemId} transferred to Telegram user ${userId}`)
    return true
  } catch (error) {
    if (isInsufficientRelayerStarsError(error)) {
      throw new UserbotTransferError(
        'STARS_INSUFFICIENT',
        'У релаера недостаточно Telegram Stars для комиссии перевода подарка',
      )
    }
    console.error(`[Userbot] Failed to transfer saved NFT for inventory item ${itemId}:`, error)
    return false
  } finally {
    giftTransfersInProgress.delete(itemId)
  }
}

/** Retries paid withdrawals when a gift arrives or the relayer tops up Stars. */
export async function retryPendingWithdrawals(): Promise<void> {
  if (!userbot || !isUserbotStarted || pendingWithdrawalRetryRunning) return
  pendingWithdrawalRetryRunning = true

  try {
    const pendingItems = await prisma.inventoryItem.findMany({
      where: {
        status: 'WITHDRAWAL_REQUESTED',
        OR: [{ giftId: { not: null } }, { prizeName: { not: '' } }],
      },
      select: { id: true, userId: true, prizeName: true },
      orderBy: { createdAt: 'asc' },
    })

    for (const item of pendingItems) {
      try {
        const sent = await sendSavedGiftToUser(item.id, item.userId)
        if (!sent) continue

        const completed = await prisma.inventoryItem.updateMany({
          where: { id: item.id, status: 'WITHDRAWAL_REQUESTED' },
          data: { status: 'CLAIMED' },
        })
        if (completed.count === 1) {
          await notifyUser(item.userId, `✅ Подарок «${item.prizeName}» успешно отправлен вам в Telegram!`)
          console.info(`[Userbot] Pending NFT withdrawal ${item.id} completed`)
        }
      } catch (error) {
        if (error instanceof UserbotTransferError && error.code === 'STARS_INSUFFICIENT') {
          console.warn(`[Userbot] Pending withdrawal ${item.id} waits for relayer Stars balance`)
          continue
        }
        console.error(`[Userbot] Pending withdrawal ${item.id} failed; it remains queued:`, error)
      }
    }
  } finally {
    pendingWithdrawalRetryRunning = false
  }
}

export async function initUserbot(): Promise<void> {
  const apiId = env.TELEGRAM_API_ID
  const apiHash = env.TELEGRAM_API_HASH
  const session = env.TELEGRAM_SESSION
  if (!apiId || !apiHash || !session) {
    console.warn('[Userbot] Пропуск запуска: нет ключей API или сессии в переменных окружения.')
    return
  }
  if (isUserbotStarted) return

  const client = new TelegramClient({
    apiId: Number(apiId),
    apiHash,
    storage: new MemoryStorage(),
  })
  userbot = client

  try {
    client.onNewMessage.add((message) => {
      void handleIncomingMessage(message).catch((error: unknown) => {
        console.error('[Userbot] Ошибка обработки Telegram update:', error)
      })
    })
    await client.start({ session: convertFromGramjsSession(session) })
    isUserbotStarted = true
    console.info('[Userbot] Успешно подключен к Telegram через актуальный MTProto слой')
  } catch (error) {
    console.error('[Userbot] Не удалось подключиться к Telegram:', error)
    await client.disconnect().catch(() => undefined)
    userbot = null
  }
}

export async function stopUserbot(): Promise<void> {
  const client = userbot
  userbot = null
  isUserbotStarted = false
  marketPriceCache = null
  marketPriceRequest = null
  marketPricePauseUntil = 0
  if (!client) return
  await client.disconnect()
  console.info('[Userbot] Отключен от Telegram')
}
