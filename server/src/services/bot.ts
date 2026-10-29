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
