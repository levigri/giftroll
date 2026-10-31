import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../db/prisma.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { getInventory, sellNft, requestNftClaim, GameError } from '../services/game.js'
import { callTelegramApi, DepositError } from '../services/deposit.js'

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

  // POST /api/nft/:id/withdraw — создать Telegram Stars-инвойс для вывода.
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
        const item = await prisma.inventoryItem.findFirst({
          where: { id: itemId, userId: user.id },
        })
        if (!item) throw new GameError('ITEM_NOT_FOUND', 'Предмет не найден', 404)
        if (item.status === 'CLAIMED') {
          throw new GameError('ALREADY_CLAIMED', 'Предмет уже выведен', 400)
        }
        if (item.status === 'WITHDRAWAL_REQUESTED') {
          throw new GameError('WITHDRAWAL_PENDING', 'Заявка на вывод уже создана', 400)
        }
        if (item.status !== 'PENDING') {
          throw new GameError('INVALID_ITEM_STATUS', 'Этот предмет нельзя отправить на вывод', 400)
        }
        if (!item.isExternal && item.lockUntil && item.lockUntil > new Date()) {
          const daysLeft = Math.ceil((item.lockUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          throw new GameError('NFT_LOCKED', `Вывод заблокирован. Осталось дней: ${daysLeft}`)
        }

        const payload = `withdraw_${item.id}`
        const invoiceLink = await callTelegramApi<string>('createInvoiceLink', {
          title: 'Вывод NFT',
          description: `Комиссия сети Telegram за пересылку «${item.prizeName}»`,
          payload,
          currency: 'XTR',
          prices: [{ label: 'Комиссия за вывод', amount: 25 }],
        })

        return reply.send({ invoiceLink })
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        if (err instanceof DepositError) {
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
