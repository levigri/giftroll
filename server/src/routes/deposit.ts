import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import {
  createInvoice,
  createGramsInvoice,
  confirmGramsDeposit,
  devCredit,
  DepositError,
  MAX_DEPOSIT_STARS,
  MIN_DEPOSIT_STARS,
} from '../services/deposit.js'

const invoiceSchema = z.object({
  amount: z
    .number()
    .int('amount must be an integer')
    .min(MIN_DEPOSIT_STARS, `amount must be >= ${MIN_DEPOSIT_STARS}`)
    .max(MAX_DEPOSIT_STARS, `amount must be <= ${MAX_DEPOSIT_STARS}`),
})

const gramsInvoiceSchema = z.object({
  gramsAmount: z
    .number()
    .finite('gramsAmount must be a finite number')
    .positive('gramsAmount must be > 0'),
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
        return await createGramsInvoice(user.id, parsed.data.gramsAmount)
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
