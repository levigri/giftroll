import type { FastifyPluginAsync } from 'fastify'
import { Bot, webhookCallback } from 'grammy'
import { z } from 'zod'
import { env } from '../config/env.js'
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
