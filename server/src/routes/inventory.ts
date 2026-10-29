import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { getInventory, sellNft, requestNftClaim, GameError } from '../services/game.js'
import { notifyUser } from '../services/bot.js'

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
          isExternal: item.isExternal,
          lockUntil: item.lockUntil?.toISOString() ?? null,
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

  // POST /api/nft/:id/withdraw — создать заявку на ручной вывод подарка.
  fastify.post<{ Params: { id: string } }>(
    '/api/nft/:id/withdraw',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const itemId = request.params.id?.trim()
      if (!itemId) {
        return reply.code(400).send({ error: 'ID предмета обязателен', code: 'VALIDATION_ERROR' })
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const item = await tx.inventoryItem.findFirst({ where: { id: itemId, userId: user.id } })
          if (!item) throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
          if (item.status === 'CLAIMED') {
            throw new GameError('ALREADY_CLAIMED', 'Предмет уже выведен', 400)
          }
          if (item.status === 'WITHDRAWAL_REQUESTED') {
            return { created: false, item }
          }
          if (item.status !== 'PENDING') {
            throw new GameError('INVALID_ITEM_STATUS', 'Этот предмет нельзя отправить на вывод', 400)
          }
          if (!item.isExternal && item.lockUntil && item.lockUntil > new Date()) {
            const daysLeft = Math.ceil((item.lockUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            throw new GameError('NFT_LOCKED', `Вывод заблокирован. Осталось дней: ${daysLeft}`)
          }

          const updatedItem = await tx.inventoryItem.update({
            where: { id: item.id },
            data: { status: 'WITHDRAWAL_REQUESTED' },
          })
          return { created: true, item: updatedItem }
        })

        if (result.created) {
          if (env.ADMIN_ID) {
            const username = user.username ? `@${user.username}` : `ID ${user.id.toString()}`
            await notifyUser(
              env.ADMIN_ID,
              `📤 Запрос на вывод NFT: ${result.item.prizeName} от ${username} (ID ${user.id.toString()})`,
            )
          } else {
            request.log.warn('[NFT_WITHDRAW] ADMIN_ID не задан, уведомление администратору пропущено')
          }
        }

        return reply.send({ ok: true, message: 'Заявка на вывод создана' })
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
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
