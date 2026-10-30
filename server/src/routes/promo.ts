import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticateTelegram } from '../middleware/auth.js'
import { checkPromoCode, openPromoCase } from '../services/promo.js'
import { GameError } from '../services/game.js'

const promoCodeSchema = z.object({
  code: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
})

export const promoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/promo/check', { preHandler: authenticateTelegram }, async (request, reply) => {
    const parsed = promoCodeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ valid: false, error: 'Введите промокод' })
    }

    const valid = await checkPromoCode(parsed.data.code)
    return valid ? { valid: true } : { valid: false, error: 'Код не найден или исчерпан' }
  })

  fastify.post('/api/promo/open', { preHandler: authenticateTelegram }, async (request, reply) => {
    const user = request.telegramUser
    if (!user) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    }

    const parsed = promoCodeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Введите промокод', code: 'PROMO_INVALID' })
    }

    try {
      return await openPromoCase(user.id, parsed.data.code)
    } catch (error) {
      if (error instanceof GameError) {
        return reply.code(error.statusCode).send({ error: error.message, code: error.code })
      }
      throw error
    }
  })
}
