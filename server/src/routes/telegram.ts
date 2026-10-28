import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import {
  DepositError,
  handleWebhook,
  setWebhook,
  type TelegramUpdate,
} from '../services/deposit.js'

const setupWebhookSchema = z.object({
  publicUrl: z.string().url('publicUrl must be a valid URL'),
})

export const telegramRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/telegram/webhook — вызывается Telegram, без нашей auth.
  // Всегда отвечаем 200: на не-200 Telegram ретраит update.
  fastify.post('/api/telegram/webhook', async (request, reply) => {
    const secret = env.WEBHOOK_SECRET
    const rawHeader = request.headers['x-telegram-bot-api-secret-token']
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

    if (!secret || provided !== secret) {
      request.log.warn('[WEBHOOK] rejected: invalid secret token')
      return reply.code(403).send({ ok: false })
    }

    try {
      await handleWebhook(request.body as TelegramUpdate)
    } catch (error) {
      // Тело update может содержать платёжные данные — логируем только ошибку.
      request.log.error(error, '[WEBHOOK] handleWebhook failed')
    }

    return reply.send({ ok: true })
  })

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
