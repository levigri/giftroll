import type { FastifyReply, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { authenticateTelegram } from '../middleware/auth.js'
import { parseBody } from '../utils/validators.js'
import { GameError } from '../services/game.js'
import {
  MAX_BET_STARS,
  MIN_BET_STARS,
  addToBet,
  displayName,
  getCurrentRound,
  getMyHistory,
  joinRound,
} from '../services/pvp.js'

const joinSchema = z.object({
  stars: z
    .number()
    .int('stars must be an integer')
    .min(MIN_BET_STARS, `stars must be >= ${MIN_BET_STARS}`)
    .max(MAX_BET_STARS, `stars must be <= ${MAX_BET_STARS}`),
})

const addBetSchema = z.object({
  roundId: z.string().min(1, 'roundId is required'),
  extraStars: z
    .number()
    .int('extraStars must be an integer')
    .min(MIN_BET_STARS, `extraStars must be >= ${MIN_BET_STARS}`)
    .max(MAX_BET_STARS, `extraStars must be <= ${MAX_BET_STARS}`),
})

function sendGameError(reply: FastifyReply, err: unknown) {
  if (err instanceof GameError) {
    return reply.code(err.statusCode).send({
      error: err.message,
      code: err.code,
    })
  }
  throw err
}

export const pvpRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/pvp/current - текущее лобби (polling раз в секунду)
  fastify.get(
    '/api/pvp/current',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        return await getCurrentRound(user.id)
      } catch (err) {
        return sendGameError(reply, err)
      }
    },
  )

  // POST /api/pvp/join - войти в игру со ставкой stars
  fastify.post(
    '/api/pvp/join',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(joinSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        return await joinRound(user.id, displayName(user), parsed.data.stars)
      } catch (err) {
        return sendGameError(reply, err)
      }
    },
  )

  // POST /api/pvp/add-bet - докинуть ⭐ к своей ставке, пока раунд открыт
  fastify.post(
    '/api/pvp/add-bet',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const parsed = parseBody(addBetSchema, request.body)
      if (!parsed.ok) {
        return reply.code(400).send({
          error: parsed.error,
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        return await addToBet(user.id, parsed.data.roundId, parsed.data.extraStars)
      } catch (err) {
        return sendGameError(reply, err)
      }
    },
  )

  // GET /api/pvp/history - последние игры игрока
  fastify.get(
    '/api/pvp/history',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      try {
        return await getMyHistory(user.id)
      } catch (err) {
        return sendGameError(reply, err)
      }
    },
  )
}
