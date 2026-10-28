import type { FastifyReply, FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { ReferralError, getStats } from '../services/referral.js'

function sendReferralError(reply: FastifyReply, err: unknown) {
  if (err instanceof ReferralError) {
    return reply.code(err.statusCode).send({
      error: err.message,
      code: err.code,
    })
  }
  throw err
}

export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/referral/stats — код, заработок и история начислений
  fastify.get(
    '/api/referral/stats',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        return await getStats(user.id)
      } catch (err) {
        return sendReferralError(reply, err)
      }
    },
  )
}
