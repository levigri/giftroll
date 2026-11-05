import { convertFromGramjsSession } from '@mtcute/convert'
import { MemoryStorage, TelegramClient, type Message } from '@mtcute/node'
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

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`
  return String(error)
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

async function confirmOutgoingGiftWithdrawal(recipientId: number): Promise<void> {
  if (!Number.isSafeInteger(recipientId) || recipientId <= 0) {
    console.warn('[Userbot] Исходящий NFT-подарок не содержит корректный ID получателя')
    return
  }

  const userId = BigInt(recipientId)
  const item = await prisma.inventoryItem.findFirst({
    where: { userId, status: 'WITHDRAWAL_REQUESTED' },
    orderBy: { createdAt: 'asc' },
  })
  if (!item) {
    console.info(`[Userbot] Для получателя ${recipientId} нет ожидающих заявок на вывод`)
    return
  }

  const claimed = await prisma.inventoryItem.updateMany({
    where: { id: item.id, userId, status: 'WITHDRAWAL_REQUESTED' },
    data: { status: 'CLAIMED' },
  })
  if (claimed.count !== 1) return

  await notifyUser(userId, '✅ Подарок успешно выведен!')
  console.info(`[Userbot] Автоматически подтвержден вывод предмета ${item.id} для пользователя ${recipientId}`)
}

async function handleIncomingMessage(message: Message): Promise<void> {
  const action = message.action
  if (message.isOutgoing) {
    if (
      message.isService &&
      message.chat.type === 'user' &&
      (action?.type === 'star_gift_transferred' || action?.type === 'star_gift_sent')
    ) {
      const recipientId = action.type === 'star_gift_sent'
        ? action.toId?.id ?? message.chat.id
        : message.chat.id
      await confirmOutgoingGiftWithdrawal(recipientId)
    }
    return
  }

  console.info(`[Userbot-DEBUG] Пришло сообщение: ID=${message.id}, isService=${message.isService}, chatType=${message.chat.type}, action=${message.action?.type ?? 'none'}, text=${message.text?.slice(0, 50) ?? 'none'}`)

  if (!message.isService || message.chat.type !== 'user') return

  const actionWithGift = action && 'gift' in action ? action : null
  if (!actionWithGift || !actionWithGift.gift) {
    console.info(`[Userbot] Событие ${action?.type} не содержит подарка. Игнорируем.`)
    return
  }

  if ('refunded' in actionWithGift && actionWithGift.refunded) {
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
  const gift = actionWithGift.gift
  const giftId = 'slug' in gift
    ? gift.slug
    : 'id' in gift
      ? gift.id.toString()
      : `unknown-${message.id}`
  const rawPrizeName = 'title' in gift && typeof gift.title === 'string'
    ? gift.title
    : `Telegram NFT #${giftId}`
  const catalogEntry = findNftCatalogEntry(rawPrizeName)
  const prizeName = catalogEntry?.name ?? rawPrizeName

  console.info(`[Userbot] Пойман NFT-подарок! ${JSON.stringify({
    id: message.id,
    peerId,
    senderId,
    giftId,
    title: rawPrizeName,
    action: actionWithGift.type,
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
