import type { FastifyReply, FastifyRequest, FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.telegramUser
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    return
  }
  if (!env.ADMIN_ID || user.id !== env.ADMIN_ID) {
    reply.code(403).send({ error: 'Forbidden', code: 'ADMIN_REQUIRED' })
  }
}

const adminPreHandler = [authenticateTelegram, requireAdmin]

function parseTelegramId(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/admin/users/search',
    { preHandler: adminPreHandler },
    async (request) => {
      const query = request.query.q?.trim().replace(/^@/, '') ?? ''
      if (!query) return []

      const conditions: Array<{
        username?: { contains: string; mode: 'insensitive' }
        id?: bigint
      }> = [{ username: { contains: query, mode: 'insensitive' } }]
      const numericId = parseTelegramId(query)
      if (numericId !== null) conditions.push({ id: numericId })

      const users = await prisma.user.findMany({
        where: { OR: conditions },
        select: {
          id: true,
          username: true,
          firstName: true,
          balance: true,
          isBetaMode: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })

      return users.map((user) => ({ ...user, id: user.id.toString(), createdAt: user.createdAt.toISOString() }))
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const id = parseTelegramId(request.params.id)
      if (id === null) {
        return reply.code(400).send({ error: 'Некорректный Telegram ID', code: 'INVALID_USER_ID' })
      }

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          photoUrl: true,
          balance: true,
          depositUnspent: true,
          referredBy: true,
          isBetaMode: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      if (!user) return reply.code(404).send({ error: 'Пользователь не найден', code: 'USER_NOT_FOUND' })

      const [inventory, deposits, transactions] = await Promise.all([
        prisma.inventoryItem.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.deposit.findMany({
          where: { userId: id },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
            txHash: true,
            gramsAmount: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.transaction.findMany({
          where: { userId: id },
          select: { id: true, type: true, amount: true, details: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ])

      return {
        user: {
          ...user,
          id: user.id.toString(),
          referredBy: user.referredBy?.toString() ?? null,
          refCode: `ref_${user.id.toString()}`,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
        inventory: inventory.map((item) => ({
          ...item,
          userId: item.userId.toString(),
          createdAt: item.createdAt.toISOString(),
          lockUntil: item.lockUntil?.toISOString() ?? null,
        })),
        deposits: deposits.map((deposit) => ({
          ...deposit,
          createdAt: deposit.createdAt.toISOString(),
        })),
        transactions: transactions.map((transaction) => ({
          ...transaction,
          createdAt: transaction.createdAt.toISOString(),
        })),
      }
    },
  )

  fastify.get('/api/admin/transactions', { preHandler: adminPreHandler }, async () => {
    const transactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, firstName: true } },
      },
    })

    return transactions.map((transaction) => ({
      id: transaction.id,
      userId: transaction.user.id.toString(),
      username: transaction.user.username,
      firstName: transaction.user.firstName,
      type: transaction.type,
      amount: transaction.amount,
      details: transaction.details,
      createdAt: transaction.createdAt.toISOString(),
    }))
  })
}
