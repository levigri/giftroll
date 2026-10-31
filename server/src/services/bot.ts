import { Bot } from 'grammy'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'

/**
 * Служебные уведомления бота (пополнения, ошибки проверки транзакций).
 *
 * Основной экземпляр бота с вебхуком живёт в routes/telegram.ts — здесь
 * только отправка сообщений, grammy для этого не требует init()/getMe.
 */
let notifyBot: Bot | null = null

function getNotifyBot(): Bot | null {
  if (!env.BOT_TOKEN) {
    return null
  }
  if (!notifyBot) {
    notifyBot = new Bot(env.BOT_TOKEN)
  }
  return notifyBot
}

/** Канал, на которую обязана подписаться для бесплатного кейса. */
export const FREE_CASE_CHANNEL = '@NewsGiftRoll'

/**
 * Проверяет подписку пользователя на канал.
 * Без токена бота (локальная разработка) пропускаем, в проде считаем неподписанным.
 */
export async function checkChannelSubscription(userId: bigint): Promise<boolean> {
  const bot = getNotifyBot()
  if (!bot) {
    return env.NODE_ENV !== 'production'
  }

  try {
    const member = await bot.api.getChatMember(FREE_CASE_CHANNEL, Number(userId))
    return member.status === 'member' || member.status === 'administrator' || member.status === 'creator'
  } catch (err) {
    // Ошибка API (нет сети, бот не админ) — считаем, что не подписан, с логом.
    console.error(`[Bot] subscription check failed for user ${userId}:`, err)
    return false
  }
}

/**
 * Отправляет пользователю служебное сообщение в Telegram.
 * Ошибка доставки не должна ломать зачисление — поэтому глотаем её с логом.
 */
export async function notifyUser(userId: bigint, text: string): Promise<void> {
  try {
    const bot = getNotifyBot()
    if (!bot) {
      return
    }
    await bot.api.sendMessage(userId.toString(), text)
  } catch (err) {
    console.error(`[Bot] notify failed for user ${userId}:`, err)
  }
}

/** Уведомляет пользователя, что ему снова доступен бесплатный кейс. */
export async function notifyDailyBonusReady(userId: bigint): Promise<boolean> {
  try {
    const bot = getNotifyBot()
    if (!bot) return false

    await bot.api.sendMessage(String(userId), '🎁 Твой бесплатный кейс готов!', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть GiftRoll', web_app: { url: 'https://giftroll-six.vercel.app/?v=2' } }],
        ],
      },
    })
    return true
  } catch (err) {
    console.error(`[Bot] daily bonus reminder failed for user ${userId}:`, err)
    return false
  }
}

/** Проверяет имя профиля в Telegram, затем использует данные из нашей БД как fallback. */
export async function checkNicknameContainsGiftRoll(userId: bigint): Promise<boolean> {
  try {
    const bot = getNotifyBot()
    if (bot) {
      const chat = await bot.api.getChat(String(userId))
      if (chat.type === 'private') {
        const fullName = `${chat.first_name ?? ''} ${chat.last_name ?? ''}`.toLowerCase()
        if (fullName.includes('giftroll')) return true
      }
    }
  } catch {
    // getChat доступен не для всех пользователей; ниже проверяем сохранённое имя.
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    return `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.toLowerCase().includes('giftroll')
  } catch (err) {
    console.error(`[Bot] nickname check failed for user ${userId}:`, err)
    return false
  }
}
