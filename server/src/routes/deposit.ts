import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import {
  createInvoice,
  createGramsInvoice,
  quoteGramsAmount,
  confirmGramsDeposit,
  devCredit,
  DepositError,
  MAX_DEPOSIT_STARS,
  MIN_DEPOSIT_STARS,
} from '../services/deposit.js'
import { createCryptoInvoice, handleCryptoWebhook } from '../services/cryptobot.js'
import { getGramRate, STARS_BASE_PRICE_USD } from '../utils/rates.js'

const invoiceSchema = z.object({
  amount: z
    .number()
    .int('amount must be an integer')
    .min(MIN_DEPOSIT_STARS, `amount must be >= ${MIN_DEPOSIT_STARS}`)
    .max(MAX_DEPOSIT_STARS, `amount must be <= ${MAX_DEPOSIT_STARS}`),
})

const gramsInvoiceSchema = z.object({
  starsAmount: z
    .number()
    .int('starsAmount must be an integer')
    .min(MIN_DEPOSIT_STARS, `starsAmount must be >= ${MIN_DEPOSIT_STARS}`)
    .max(MAX_DEPOSIT_STARS, `starsAmount must be <= ${MAX_DEPOSIT_STARS}`),
})

const gramsConfirmSchema = z.object({
  depositId: z.string().min(1, 'depositId is required'),
  transactionBoc: z.string().min(1, 'transactionBoc is required').max(100_000),
})

const devCreditSchema = z.object({
  amount: z
    .number()
    .int('amount must be an integer')
    .positive('amount must be > 0')
    .max(MAX_DEPOSIT_STARS, `amount must be <= ${MAX_DEPOSIT_STARS}`),
})

export const depositRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/deposit/invoice — инвойс Telegram Stars на amount ⭐
  fastify.post(
    '/api/deposit/invoice',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(invoiceSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await createInvoice(user.id, parsed.data.amount)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // POST /api/deposit/grams/invoice — pending-депозит в Grams (+5% к ⭐)
  fastify.post(
    '/api/deposit/grams/invoice',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(gramsInvoiceSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await createGramsInvoice(user.id, parsed.data.starsAmount)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // POST /api/deposit/grams/quote — точная серверная оценка до создания депозита.
  fastify.post(
    '/api/deposit/grams/quote',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(gramsInvoiceSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await quoteGramsAmount(parsed.data.starsAmount)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // POST /api/deposit/grams/confirm — подтверждение перевода и зачисление ⭐
  fastify.post(
    '/api/deposit/grams/confirm',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(gramsConfirmSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await confirmGramsDeposit(
          user.id,
          parsed.data.depositId,
          parsed.data.transactionBoc,
        )
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // GET /api/deposit/rates — базовый курс звёзд и живой курс Gram для экрана пополнения.
  fastify.get('/api/deposit/rates', async () => {
    const tonUsd = await getGramRate()
    return { starsUsd: STARS_BASE_PRICE_USD, tonUsd }
  })

  // POST /api/deposit/crypto/invoice — счёт @CryptoBot (Crypto Pay) на amount ⭐
  fastify.post(
    '/api/deposit/crypto/invoice',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(invoiceSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await createCryptoInvoice(user.id, parsed.data.amount)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // POST /api/deposit/crypto/webhook — публичный вебхук Crypto Pay (без авторизации).
  // Всегда отвечает { ok: true }, чтобы Crypto Bot не повторял доставку бесконечно.
  fastify.post('/api/deposit/crypto/webhook', async (request, reply) => {
    try {
      return await handleCryptoWebhook(request.body)
    } catch (err) {
      request.log.error(err)
      return reply.code(200).send({ ok: true })
    }
  })

  if (env.NODE_ENV !== 'production') {
    // POST /api/deposit/dev-credit — ⚠️ DEV ONLY, мгновенное начисление без оплаты
    fastify.post(
    '/api/deposit/dev-credit',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(devCreditSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error, code: 'VALIDATION_ERROR' })
      }

      try {
        return await devCredit(user.id, parsed.data.amount)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
    )

    // POST /api/deposit/mock-50 — ⚠️ MOCK для тестов: +50 ⭐ дев-аккаунту.
    fastify.post(
    '/api/deposit/mock-50',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        return await devCredit(user.id, 50)
      } catch (err) {
        if (err instanceof DepositError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
    )
  }
}
