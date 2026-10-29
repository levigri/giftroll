import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'

let userbot: TelegramClient | null = null
let isUserbotStarted = false

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  )
}

function stringifyTelegramObject(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(
      value,
      (key, current: unknown) => {
        if (key === 'client' || key === '_client') return undefined
        if (typeof current === 'bigint') return current.toString()
        if (current && typeof current === 'object') {
          if (seen.has(current)) return '[Circular]'
          seen.add(current)
        }
        return current
      },
    )
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`
  }
}

async function handleIncomingMessage(event: NewMessageEvent): Promise<void> {
  const message = event.message
  const action = message.action

  // Telegram represents a regular gift and a collectible NFT as different
  // service actions. Only the unique collectible action is eligible here.
  if (action instanceof Api.MessageActionStarGift) {
    console.info(`[Userbot] Получен обычный гифт в сообщении ${message.id}. Игнорируем.`)
    return
  }
  if (!(action instanceof Api.MessageActionStarGiftUnique)) {
    return
  }
  if (action.refunded) {
    console.info(`[Userbot] NFT-подарок в сообщении ${message.id} возвращён. Игнорируем.`)
    return
  }

  console.info(`[Userbot] Пойман NFT-подарок! RAW NFT: ${stringifyTelegramObject(action).substring(0, 2000)}`)

  const peer = message.peerId
  const senderPeer = action.fromId
  if (!(peer instanceof Api.PeerUser) || !(senderPeer instanceof Api.PeerUser)) {
    console.warn(`[Userbot] Подарок в сообщении ${message.id} без адресуемого отправителя`)
    return
  }

  const peerId = peer.userId.toString()
  const senderUserId = BigInt(senderPeer.userId.toString())
  const user = await prisma.user.findUnique({ where: { id: senderUserId } })
  if (!user) {
    console.info(`[Userbot] Подарок в сообщении ${message.id}: Telegram-пользователь не найден в GiftRoll`)
    return
  }

  const giftId = action.gift.id.toString()
  const prizeName =
    'title' in action.gift && typeof action.gift.title === 'string'
      ? action.gift.title
      : `Telegram NFT #${giftId}`
  try {
    await prisma.$transaction(async (tx) => {
      const inventoryItem = await tx.inventoryItem.create({
        data: {
          userId: user.id,
          prizeId: `telegram-gift:${peerId}:${message.id}`,
          prizeName,
          prizeEmoji: '🎁',
          prizePrice: 0,
          isExternal: true,
          lockUntil: null,
        },
      })

      await tx.telegramGiftReceipt.create({
        data: {
          peerId,
          messageId: message.id,
          senderUserId,
          inventoryItemId: inventoryItem.id,
        },
      })
    })

    console.info(`[Userbot] Telegram Gift #${giftId} зачислен в инвентарь GiftRoll`)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      console.info(`[Userbot] Повторное событие подарка пропущено (message ${message.id})`)
      return
    }
    console.error('[Userbot] Не удалось зачислить Telegram Gift:', error)
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

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  })
  userbot = client

  try {
    await client.connect()
    if (!(await client.checkAuthorization())) {
      console.warn('[Userbot] Сессия не авторизована. Проверьте TELEGRAM_SESSION.')
      await client.disconnect()
      userbot = null
      return
    }

    client.addEventHandler(
      (event) => {
        void handleIncomingMessage(event).catch((error: unknown) => {
          console.error('[Userbot] Ошибка обработки Telegram update:', error)
        })
      },
      new NewMessage({ incoming: true }),
    )
    isUserbotStarted = true
    console.info('[Userbot] Успешно подключен к Telegram')
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
  if (!client) return
  await client.disconnect()
  console.info('[Userbot] Отключен от Telegram')
}
