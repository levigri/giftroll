import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import { GameError } from '../services/game.js'
import { MAX_CHANCE, MAX_NFT_IDS, MAX_TOTAL_BET, MIN_CHANCE, performUpgrade } from '../services/upgrader.js'

const upgradeSchema = z.object({
  nftIds: z
    .array(z.string().min(1, 'nft id must not be empty'))
    .max(MAX_NFT_IDS, `nftIds must contain at most ${MAX_NFT_IDS} items`),
  starsBet: z
    .number()
    .finite('starsBet must be a finite number')
    .int('starsBet must be an integer')
    .min(0, 'starsBet must be >= 0')
    .max(MAX_TOTAL_BET, `starsBet must be <= ${MAX_TOTAL_BET}`),
  chance: z
    .number()
    .min(MIN_CHANCE, `chance must be >= ${MIN_CHANCE}`)
    .max(MAX_CHANCE, `chance must be <= ${MAX_CHANCE}`),
  targetNftId: z.string().min(1, 'targetNftId is required'),
})

export const upgraderRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/upgrader/upgrade - ставка ⭐ + NFT на выбранный шанс
  fastify.post(
    '/api/upgrader/upgrade',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(upgradeSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        return await performUpgrade(
          user.id,
          parsed.data.nftIds,
          parsed.data.starsBet,
          parsed.data.chance,
          parsed.data.targetNftId,
        )
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
