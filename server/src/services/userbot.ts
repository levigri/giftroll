import { convertFromGramjsSession } from '@mtcute/convert'
import { MemoryStorage, TelegramClient, type Message, type SavedStarGift } from '@mtcute/node'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { findNftCatalogEntry } from './nftPricing.js'

let userbot: TelegramClient | null = null
let isUserbotStarted = false
let marketPriceCache: { expiresAt: number; prices: Map<string, number> } | null = null
let marketPriceRequest: Promise<Map<string, number> | null> | null = null

function normalizeGiftName(name: string): string {
  return name.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

type UniqueGiftLike = { id: { toString(): string }; title: string; isUnique: true }

function isUniqueGift(value: unknown): value is UniqueGiftLike {
  return Boolean(
    value && typeof value === 'object' && 'isUnique' in value && value.isUnique === true &&
    'id' in value && 'title' in value && typeof value.title === 'string',
  )
}

async function handleIncomingMessage(message: Message): Promise<void> {
  if (message.isOutgoing || !message.isService || message.chat.type !== 'user') return

  const action = message.action
  if (action?.type === 'star_gift_sent') {
    console.info(`[Userbot] Получен обычный гифт в сообщении ${message.id}. Игнорируем.`)
    return
  }
  if (!action || !('gift' in action) || !isUniqueGift(action.gift)) return
  if ('refunded' in action && action.refunded) {
    console.info(`[Userbot] NFT-подарок в сообщении ${message.id} возвращён. Игнорируем.`)
    return
  }

  const senderId = message.sender.id
  const peerId = message.chat.id
  const senderUserId = BigInt(senderId)
  const giftId = action.gift.id.toString()
  const rawPrizeName = action.gift.title || `Telegram NFT #${giftId}`
  const catalogEntry = findNftCatalogEntry(rawPrizeName)
  const prizeName = catalogEntry?.name ?? rawPrizeName

  console.info(`[Userbot] Пойман NFT-подарок! ${JSON.stringify({
    id: message.id,
    peerId,
    senderId,
    giftId,
    title: rawPrizeName,
    action: action.type,
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
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      console.info(`[Userbot] Повторное событие подарка пропущено (message ${message.id})`)
      return
    }
    console.error('[Userbot] Не удалось зачислить Telegram NFT:', error)
  }
}

async function getMarketPrices(): Promise<Map<string, number> | null> {
  if (marketPriceCache && marketPriceCache.expiresAt > Date.now()) return marketPriceCache.prices
  if (marketPriceRequest) return marketPriceRequest
  const client = userbot
  if (!client || !isUserbotStarted) return null

  marketPriceRequest = (async () => {
    try {
      const gifts = await client.getStarGiftOptions()
      const prices = new Map<string, number>()
      const catalogNames = new Set(nftCatalog.map((gift) => normalizeGiftName(gift.name)))
      const marketCollections = gifts.filter(
        (gift) => gift.title && catalogNames.has(normalizeGiftName(gift.title)),
      )
      let nextIndex = 0

      // Query actual active resale listings, rather than the collection-level
      // resale_min_stars summary returned by getStarGifts.
      const workers = Array.from({ length: Math.min(4, marketCollections.length) }, async () => {
        while (nextIndex < marketCollections.length) {
          const gift = marketCollections[nextIndex++]
          if (!gift?.title) continue

          try {
            const listings = await client.getStarGiftResaleOptions({
              giftId: gift.id,
              sort: 'price',
              limit: 100,
            })
            const starPrices = listings
              .map((listing) => Number(listing.resellPriceStars?.toString() ?? 0))
              .filter((price) => Number.isSafeInteger(price) && price > 0)

            if (starPrices.length > 0) {
              prices.set(normalizeGiftName(gift.title), Math.min(...starPrices))
            }
          } catch (error) {
            console.warn(`[Userbot] Не удалось получить объявления для «${gift.title}»:`, error)
          }
        }
      })

      await Promise.all(workers)
      console.info(`[Userbot] Актуальные цены Telegram Marketplace обновлены: ${prices.size} коллекций`)
      marketPriceCache = { prices, expiresAt: Date.now() + 60_000 }
      return prices
    } catch (error) {
      console.warn('[Userbot] Не удалось получить цены Telegram Marketplace:', error)
      return null
    } finally {
      marketPriceRequest = null
    }
  })()
  return marketPriceRequest
}

/** Current minimum Stars listing for the gift collection from Telegram Marketplace. */
export async function getTelegramMarketPrice(prizeName: string): Promise<number | null> {
  const prices = await getMarketPrices()
  return prices?.get(normalizeGiftName(prizeName)) ?? null
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
      where: { id: item.id, userId, status: 'PENDING', giftId: null },
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
  if (!client || !isUserbotStarted) return false

  try {
    const gift = await findAvailableRelayerGift(itemId, userId)
    if (!gift || !isUniqueGift(gift.gift)) return false
    if (gift.transferStars && BigInt(gift.transferStars.toString()) > 0n) return false
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
    console.error(`[Userbot] Failed to transfer saved NFT for inventory item ${itemId}:`, error)
    return false
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
  if (!client) return
  await client.disconnect()
  console.info('[Userbot] Отключен от Telegram')
}
