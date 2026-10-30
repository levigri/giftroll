import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'
import { claimDaily, claimFreeCase, GameError } from '../services/game.js'
import { checkChannelSubscription } from '../services/bot.js'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export const dailyBonusRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/daily-bonus/check-subscription — подписан ли игрок на @NewsGiftRoll.
  fastify.get(
    '/api/daily-bonus/check-subscription',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const subscribed = await checkChannelSubscription(user.id)
      return { subscribed }
    },
  )

  // POST /api/daily-bonus/claim — бесплатный кейс: 24 часа + подписка на канал.
  fastify.post(
    '/api/daily-bonus/claim',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        // 1. Готовность бонуса (раз в 24 часа) — та же проверка, что внутри claimDaily.
        const dailyBonus = await prisma.dailyBonus.findUnique({ where: { userId: user.id } })
        if (
          dailyBonus &&
          Date.now() - dailyBonus.lastClaimedAt.getTime() < TWENTY_FOUR_HOURS_MS
        ) {
          throw new GameError('BONUS_NOT_READY', 'Бонус ещё не доступен', 400)
        }

        // 2. Обязательная подписка на канал.
        const subscribed = await checkChannelSubscription(user.id)
        if (!subscribed) {
          throw new GameError('NOT_SUBSCRIBED', 'Сначала подпишись на канал', 403)
        }

        return await claimDaily(user.id)
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )

  // POST /api/daily-bonus/claim-deposit — бонусный кейс за депозит от 200 ⭐.
  fastify.post(
    '/api/daily-bonus/claim-deposit',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        return await claimFreeCase(user.id)
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )
}
