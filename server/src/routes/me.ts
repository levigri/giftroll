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

      // Когда откроется следующий бесплатный кейс — для таймера на карточке.
      const dailyBonusAvailableAt = dailyBonus
        ? new Date(dailyBonus.lastClaimedAt.getTime() + TWENTY_FOUR_HOURS_MS).toISOString()
        : null

      return {
        id: user.id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
        balance: user.balance,
        inventoryCount,
        dailyBonusAvailable,
        dailyBonusAvailableAt: dailyBonusAvailable ? null : dailyBonusAvailableAt,
        // Неоткрытые бонусные кейсы за депозиты от 200 ⭐.
        freeCases: user.freeCases,
        // Итог привязки по реф-ссылке в этом запросе; null — кода не было.
        referral: request.referralBind ?? null,
        createdAt: user.createdAt.toISOString(),
      }
    },
  )

  // GET /api/transactions?limit=30 — история операций по балансу (новые сверху).
  fastify.get(
    '/api/transactions',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
        })
      }

      const rawLimit = Number((request.query as { limit?: unknown } | undefined)?.limit)
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 30

      const rows = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
      }))
    },
  )
}
