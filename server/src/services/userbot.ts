import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'

const apiId = env.TELEGRAM_API_ID ?? 0
const apiHash = env.TELEGRAM_API_HASH ?? ''
const stringSession = new StringSession(env.TELEGRAM_SESSION ?? '')

export const userbot = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
})

let isUserbotStarted = false

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'P2002',
  )
}

async function handleIncomingMessage(event: NewMessageEvent): Promise<void> {
  const message = event.message

  if (message.media) {
    console.info(`[Userbot] Получено медиа: ${message.media.className}`)
  }

  const action = message.action
  if (!(action instanceof Api.MessageActionStarGift) || action.refunded) {
    return
  }

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
  const giftPrice =
    action.gift instanceof Api.StarGift ? Number(action.gift.stars.toString()) : 0
  const prizePrice = Number.isSafeInteger(giftPrice) && giftPrice > 0 ? giftPrice : 0
  const prizeName = `Telegram Gift #${giftId}`
  // Telegram service message date is the time the gift was purchased/transferred
  // to this account. Use it instead of processing time so delayed updates do not
  // restart the 21-day holding period.
  const acquiredAt = new Date(message.date * 1000)
  const lockUntil = new Date(acquiredAt.getTime() + 21 * 24 * 60 * 60 * 1000)

  try {
    await prisma.$transaction(async (tx) => {
      const inventoryItem = await tx.inventoryItem.create({
        data: {
          userId: user.id,
          prizeId: `telegram-gift:${peerId}:${message.id}`,
          prizeName,
          prizeEmoji: '🎁',
          prizePrice,
          isExternal: true,
          lockUntil,
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
  if (!env.TELEGRAM_SESSION) {
    console.warn('[Userbot] TELEGRAM_SESSION не задан. Пропускаем запуск юзербота.')
    return
  }
  if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH) {
    console.warn('[Userbot] TELEGRAM_API_ID или TELEGRAM_API_HASH не заданы. Пропускаем запуск.')
    return
  }
  if (isUserbotStarted) return

  try {
    await userbot.connect()
    if (!(await userbot.checkAuthorization())) {
      console.warn('[Userbot] Сессия не авторизована. Проверьте TELEGRAM_SESSION.')
      await userbot.disconnect()
      return
    }

    userbot.addEventHandler(
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
    await userbot.disconnect().catch(() => undefined)
  }
}

export async function stopUserbot(): Promise<void> {
  if (!isUserbotStarted) return
  await userbot.disconnect()
  isUserbotStarted = false
  console.info('[Userbot] Отключен от Telegram')
}
