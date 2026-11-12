import type { FastifyPluginAsync } from 'fastify'
import { Bot, webhookCallback } from 'grammy'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import {
  DepositError,
  callTelegramApi,
  handleWebhook,
  setWebhook,
  type TelegramUpdate,
} from '../services/deposit.js'

const setupWebhookSchema = z.object({
  publicUrl: z.string().url('publicUrl must be a valid URL'),
})

export const telegramRoutes: FastifyPluginAsync = async (fastify) => {
  const bot = new Bot(env.BOT_TOKEN)
  type BroadcastState =
    | { stage: 'awaiting_text' }
    | { stage: 'awaiting_recipient_count'; text: string; totalUsers: number }
    | { stage: 'awaiting_confirmation'; text: string; recipientLimit: number | null }
  let broadcastState: BroadcastState | null = null
  let broadcastRunning = false

  const isAdmin = (telegramId: number | undefined): boolean =>
    telegramId !== undefined && env.ADMIN_ID !== undefined && BigInt(telegramId) === env.ADMIN_ID

  const delay = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return
    if (broadcastRunning) {
      await ctx.reply('Рассылка уже выполняется. Дождись отчёта перед запуском следующей.')
      return
    }

    broadcastState = { stage: 'awaiting_text' }
    await ctx.reply('Пришли текст рассылки одним сообщением. Чтобы отменить, отправь /cancel.')
  })

  bot.command('cancel', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || !broadcastState) return
    broadcastState = null
    await ctx.reply('Создание рассылки отменено.')
  })

  bot.on('message:text', async (ctx) => {
    if (!isAdmin(ctx.from?.id) || !broadcastState) return
    const messageText = ctx.message.text.trim()
    if (messageText.startsWith('/')) return

    if (broadcastState.stage === 'awaiting_text') {
      if (!messageText) return
      if (messageText.length > 3800) {
        await ctx.reply('Сообщение слишком длинное. Максимум 3800 символов, пришли сокращённый текст.')
        return
      }

      const totalUsers = await prisma.user.count()
      if (totalUsers === 0) {
        broadcastState = null
        await ctx.reply('В базе пока нет пользователей для рассылки.')
        return
      }

      broadcastState = { stage: 'awaiting_recipient_count', text: messageText, totalUsers }
      await ctx.reply(`Скольким пользователям отправить? Напиши число от 1 до ${totalUsers} или «всем».\nЧтобы отменить — /cancel.`)
      return
    }

    if (broadcastState.stage === 'awaiting_recipient_count') {
      const draft = broadcastState
      const recipientLimit = /^всем$/i.test(messageText) ? null : Number(messageText)
      if (recipientLimit !== null && (!Number.isInteger(recipientLimit) || recipientLimit < 1 || recipientLimit > draft.totalUsers)) {
        await ctx.reply(`Введи целое число от 1 до ${draft.totalUsers} или напиши «всем».`)
        return
      }

      const recipientCount = recipientLimit ?? draft.totalUsers
      broadcastState = { stage: 'awaiting_confirmation', text: draft.text, recipientLimit }
      await ctx.reply(`Предпросмотр рассылки (${recipientCount} из ${draft.totalUsers} пользователей):\n\n${draft.text}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: `Опубликовать · ${recipientCount}`, callback_data: 'admin_broadcast:confirm' },
          { text: 'Отмена', callback_data: 'admin_broadcast:cancel' },
        ]],
      },
      })
    }
  })

  bot.callbackQuery(/^admin_broadcast:(confirm|cancel)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Недостаточно прав', show_alert: true })
      return
    }

    const action = ctx.match[1]
    if (action === 'cancel') {
      broadcastState = null
      await ctx.answerCallbackQuery({ text: 'Рассылка отменена' })
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined)
      await ctx.editMessageText('Рассылка отменена.').catch(() => undefined)
      return
    }

    if (broadcastRunning || broadcastState?.stage !== 'awaiting_confirmation') {
      await ctx.answerCallbackQuery({ text: 'Рассылка уже запущена или черновик устарел', show_alert: true })
      return
    }

    const { text, recipientLimit } = broadcastState
    broadcastState = null
    broadcastRunning = true
    await ctx.answerCallbackQuery({ text: 'Запускаю рассылку' }).catch((error: unknown) => {
      fastify.log.warn(error, '[Broadcast] callback acknowledgement failed')
    })
    await ctx.editMessageText('⏳ Рассылка запускается…\nПодготовлю получателей и обновлю это сообщение результатом.').catch((error: unknown) => {
      fastify.log.warn(error, '[Broadcast] could not update confirmation message')
    })
    const statusMessage = ctx.callbackQuery.message

    void (async () => {
      let sent = 0
      let failed = 0
      let firstDeliveryError: string | null = null
      try {
        const allUsers = await prisma.user.findMany({ select: { id: true } })
        // Перемешиваем список, чтобы при ограниченной рассылке не выбирать каждый раз
        // только одних и тех же пользователей в порядке ID.
        for (let index = allUsers.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1))
          const user = allUsers[index]
          allUsers[index] = allUsers[swapIndex]
          allUsers[swapIndex] = user
        }
        const users = recipientLimit === null ? allUsers : allUsers.slice(0, recipientLimit)
        for (const user of users) {
          try {
            await bot.api.sendMessage(user.id.toString(), text, {
              reply_markup: {
                inline_keyboard: [[{
                  text: '🎮 Запустить GiftRoll',
                  web_app: { url: 'https://giftroll-six.vercel.app/?v=2' },
                }]],
              },
            })
            sent += 1
          } catch (error: unknown) {
            failed += 1
            const message = error instanceof Error ? error.message : String(error)
            firstDeliveryError ??= message
            fastify.log.warn(`[Broadcast] delivery failed for user ${user.id}: ${message}`)
          }
          await delay(50)

          const processed = sent + failed
          if (statusMessage && processed % 100 === 0 && processed < users.length) {
            await bot.api.editMessageText(
              statusMessage.chat.id,
              statusMessage.message_id,
              `⏳ Рассылка выполняется…\nОбработано: ${processed}/${users.length}\nДоставлено: ${sent}\nОшибок доставки: ${failed}`,
            ).catch((error: unknown) => fastify.log.warn(error, '[Broadcast] progress update failed'))
          }
        }

        const summary = `✅ Рассылка завершена.\nДоставлено: ${sent}\nОшибок доставки: ${failed}\nВыбрано получателей: ${users.length}${firstDeliveryError ? `\nПример ошибки: ${firstDeliveryError.slice(0, 250)}` : ''}`
        if (statusMessage) {
          await bot.api.editMessageText(statusMessage.chat.id, statusMessage.message_id, summary).catch(async (error: unknown) => {
            fastify.log.warn(error, '[Broadcast] could not update final status')
            await bot.api.sendMessage(env.ADMIN_ID!.toString(), summary).catch((sendError: unknown) => {
              fastify.log.error(sendError, '[Broadcast] could not send final report')
            })
          })
        } else {
          await bot.api.sendMessage(env.ADMIN_ID!.toString(), summary)
        }
        fastify.log.info(`[Broadcast] completed: sent=${sent}, failed=${failed}, total=${users.length}`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        fastify.log.error(`[Broadcast] aborted: ${message}`)
        const failure = `❌ Рассылка остановлена.\nДоставлено: ${sent}\nОшибок доставки: ${failed}\nПричина: ${message.slice(0, 500)}`
        if (statusMessage) {
          await bot.api.editMessageText(statusMessage.chat.id, statusMessage.message_id, failure).catch(() => undefined)
        }
        await bot.api.sendMessage(env.ADMIN_ID!.toString(), failure).catch(() => undefined)
      } finally {
        broadcastRunning = false
      }
    })()
  })

  // Always stop Telegram's button spinner, including callbacks from stale keyboards.
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery().catch((error: unknown) => {
      fastify.log.warn(error, '[Telegram] callback acknowledgement failed')
    })
  })

  bot.command('start', async (ctx) => {
    const welcomeText = `👋 Добро пожаловать в GiftRoll!\n\n🎁 Открывай кейсы, собирай реальные NFT из Telegram Gifts и зарабатывай звёзды.\n\n🚨 Мультиаккаунты запрещены\n📢 Наш канал: t.me/NewsGiftRoll\n\nЖми на кнопку ниже, чтобы начать!`
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🎮 Играть в GiftRoll', web_app: { url: 'https://giftroll-six.vercel.app/?v=2' } }],
      ],
    }

    try {
      await ctx.replyWithPhoto('https://giftroll-six.vercel.app/welcome.png', {
        caption: welcomeText,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    } catch {
      await ctx.reply(welcomeText, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    }
  })

  const handleTelegramWebhook = webhookCallback(bot, 'fastify', {
    secretToken: env.WEBHOOK_SECRET,
  })

  // POST /api/telegram/webhook — вызывается Telegram, без нашей auth.
  // Ошибка обработки должна дойти до Telegram, чтобы update был повторён.
  fastify.post('/api/telegram/webhook', async (request, reply) => {
    const secret = env.WEBHOOK_SECRET
    const rawHeader = request.headers['x-telegram-bot-api-secret-token']
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

    if (!secret || provided !== secret) {
      request.log.warn('[WEBHOOK] rejected: invalid secret token')
      return reply.code(403).send({ ok: false })
    }

    try {
      await handleTelegramWebhook(request, reply)
    } catch (error) {
      request.log.error(error, '[WEBHOOK] grammY update failed')
      throw error
    }

    try {
      await handleWebhook(request.body as TelegramUpdate)
    } catch (error) {
      // Тело update может содержать платёжные данные — логируем только ошибку.
      request.log.error(error, '[WEBHOOK] handleWebhook failed')
    }

    return reply
  })

  // Включите inline mode через @BotFather (/setinline).
  fastify.post(
    '/api/telegram/prepare-share',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ ok: false, error: 'Unauthorized' })
      }

      const userId = Number(user.id)
      if (!Number.isSafeInteger(userId)) {
        return reply.code(400).send({ ok: false, error: 'Invalid Telegram user ID' })
      }

      try {
        const preparedMessage = await callTelegramApi<{
          id: string
          expiration_date: number
        }>('savePreparedInlineMessage', {
          user_id: userId,
          result: {
            type: 'photo',
            id: `share_${Date.now()}`,
            photo_url: 'https://giftroll-six.vercel.app/free-case-banner.jpg',
            thumbnail_url: 'https://giftroll-six.vercel.app/free-case-banner.jpg',
            title: 'GiftRoll',
            description: 'Открывай кейсы и получай NFT!',
            caption: 'Залетай в GiftRoll! Открывай кейсы и получай NFT!',
            reply_markup: {
              inline_keyboard: [[{
                text: '🎁 Играть в GiftRoll',
                url: 'https://t.me/Giftrollgamebot',
              }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: true,
          allow_group_chats: true,
          allow_channel_chats: true,
        })

        return { preparedMessageId: preparedMessage.id }
      } catch (error) {
        request.log.error(error, '[TELEGRAM] failed to prepare share message')
        const statusCode = error instanceof DepositError ? error.statusCode : 502
        const message = error instanceof Error ? error.message : 'Failed to prepare share message'
        return reply.code(statusCode).send({ ok: false, error: message })
      }
    },
  )

  // POST /api/telegram/setup-webhook — однократная настройка после деплоя
  fastify.post(
    '/api/telegram/setup-webhook',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(setupWebhookSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        const ok = await setWebhook(parsed.data.publicUrl)
        return { ok }
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({
            error: err.message,
            code: err.code,
          })
        }
        throw err
      }
    },
  )
}
