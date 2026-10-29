import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'

const NFT_LOCK_MS = 21 * 24 * 60 * 60 * 1000

export const devRoutes: FastifyPluginAsync = async (fastify) => {
  // Do not register dev tools on production; requests will receive a 404.
  if (env.NODE_ENV === 'production') return

  fastify.post(
    '/api/dev/mock-gift',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      }

      const now = new Date()
      const item = await prisma.inventoryItem.create({
        data: {
          userId: user.id,
          prizeId: `dev-nft:${user.id}:${now.getTime()}`,
          prizeName: 'NFT LolPop',
          prizeEmoji: '🎁',
          prizePrice: 150,
          isExternal: true,
          lockUntil: new Date(now.getTime() + NFT_LOCK_MS),
        },
      })

      return reply.code(201).send({
        ok: true,
        item: {
          id: item.id,
          prizeName: item.prizeName,
          isExternal: item.isExternal,
          lockUntil: item.lockUntil?.toISOString() ?? null,
        },
      })
    },
  )
}
