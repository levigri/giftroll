import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { claimDaily, GameError } from '../services/game.js'

export const dailyBonusRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/claim-daily',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
        })
      }

      try {
        const result = await claimDaily(user.id)
        return result
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
