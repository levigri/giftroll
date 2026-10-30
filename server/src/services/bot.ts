import { Bot } from 'grammy'
import { env } from '../config/env.js'

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
