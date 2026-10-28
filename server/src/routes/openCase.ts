import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { openCaseSchema, openMultiCaseSchema, parseBody } from '../utils/validators.js'
import { openCase, openMultiCase, GameError } from '../services/game.js'

export const openCaseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/open-case',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
        })
      }

      const parsed = parseBody(openCaseSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        const result = await openCase(user.id, parsed.data.caseId)
        return {
          prize: {
            id: result.prize.id,
            name: result.prize.name,
            emoji: result.prize.emoji,
            type: result.prize.type,
            price: result.prize.price,
          },
          newBalance: result.newBalance,
          caseOpenId: result.caseOpenId,
        }
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({
            error: err.message,
            code: err.code,
          })
        }
        throw err
      }
    },
  )

  // Мульти-открытие: одно списание, count независимых роллов.
  fastify.post(
    '/api/open-multi-case',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
        })
      }

      const parsed = parseBody(openMultiCaseSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        return await openMultiCase(user.id, parsed.data.caseId, parsed.data.count)
      } catch (err) {
        if (err instanceof GameError) {
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
