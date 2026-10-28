import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export const meRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/me',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
        })
      }

      const [inventoryCount, dailyBonus] = await Promise.all([
        prisma.inventoryItem.count({
          where: { userId: user.id },
        }),
        prisma.dailyBonus.findUnique({
          where: { userId: user.id },
        }),
      ])

      const dailyBonusAvailable =
        !dailyBonus || Date.now() - dailyBonus.lastClaimedAt.getTime() >= TWENTY_FOUR_HOURS_MS

      return {
        id: user.id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
        balance: user.balance,
        inventoryCount,
        dailyBonusAvailable,
        // Итог привязки по реф-ссылке в этом запросе; null — кода не было.
        referral: request.referralBind ?? null,
        createdAt: user.createdAt.toISOString(),
      }
    },
  )
}
