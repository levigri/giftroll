import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { getInventory, sellNft, requestNftClaim, GameError } from '../services/game.js'

export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/inventory - список предметов инвентаря
  fastify.get(
    '/api/inventory',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const items = await getInventory(user.id)

      return {
        items: items.map((item) => ({
          id: item.id,
          userId: item.userId.toString(),
          prizeId: item.prizeId,
          prizeName: item.prizeName,
          prizeEmoji: item.prizeEmoji,
          prizePrice: item.prizePrice,
          giftId: item.giftId,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
        })),
      }
    },
  )

  // DELETE /api/nft/:id - продажа NFT за звёзды
  fastify.delete<{ Params: { id: string } }>(
    '/api/nft/:id',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const itemId = request.params.id?.trim()
      if (!itemId) {
        return reply.code(400).send({
          error: 'ID предмета обязателен',
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        const result = await sellNft(user.id, itemId)
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

  // POST /api/nft/:id/claim - запрос на вывод NFT
  fastify.post<{ Params: { id: string } }>(
    '/api/nft/:id/claim',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const itemId = request.params.id?.trim()
      if (!itemId) {
        return reply.code(400).send({
          error: 'ID предмета обязателен',
          code: 'VALIDATION_ERROR',
        })
      }

      try {
        const result = await requestNftClaim(user.id, itemId)
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
