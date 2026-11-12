import type { FastifyReply, FastifyRequest, FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'
import { allCases } from '../data/cases.js'
import { getTaskDefinition, getTaskDefinitions } from '../services/taskDefinitions.js'

const channelTaskSchema = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  channelUsername: z.string().trim().regex(/^@?[A-Za-z0-9_]{5,32}$/),
  reward: z.number().int().min(1).max(100_000),
  maxCompletions: z.number().int().min(1).max(100_000),
})

const taskUpdateSchema = z.object({
  reward: z.number().int().min(1).max(100_000).optional(),
  maxCompletions: z.number().int().min(1).max(100_000).nullable().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0)

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
const DEV_TELEGRAM_ID = 11111111n

function parseTelegramId(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { q?: string; sort?: string } }>(
    '/api/admin/users/search',
    { preHandler: adminPreHandler },
    async (request) => {
      const query = request.query.q?.trim().replace(/^@/, '') ?? ''
      const sort = request.query.sort === 'balance_asc' || request.query.sort === 'username_asc'
        ? request.query.sort
        : 'balance_desc'
      const conditions: Array<{ username?: { contains: string; mode: 'insensitive' }; id?: bigint }> = []
      if (query) {
        conditions.push({ username: { contains: query, mode: 'insensitive' } })
        const numericId = parseTelegramId(query)
        if (numericId !== null) conditions.push({ id: numericId })
      }

      const users = await prisma.user.findMany({
        where: {
          balance: { gte: 50 },
          id: { not: DEV_TELEGRAM_ID },
          ...(conditions.length > 0 ? { OR: conditions } : {}),
        },
        select: {
          id: true,
          username: true,
          firstName: true,
          balance: true,
          isBetaMode: true,
          createdAt: true,
        },
        orderBy: sort === 'balance_asc'
          ? [{ balance: 'asc' }, { username: 'asc' }]
          : sort === 'username_asc'
            ? [{ username: { sort: 'asc', nulls: 'last' } }, { firstName: 'asc' }]
            : [{ balance: 'desc' }, { username: { sort: 'asc', nulls: 'last' } }],
        take: 500,
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
      if (id === DEV_TELEGRAM_ID) {
        return reply.code(404).send({ error: 'Пользователь не найден', code: 'USER_NOT_FOUND' })
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

      const [inventory, deposits, transactions, caseOpens, upgraderAttempts] = await Promise.all([
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
          where: { userId: id, type: 'DEPOSIT', amount: { gt: 0 } },
          select: { id: true, type: true, amount: true, details: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        prisma.caseOpen.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.upgraderAttempt.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 100,
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
        caseOpens: caseOpens.map((entry) => {
          const caseItem = allCases.find((item) => item.id === entry.caseId)
          const prize = caseItem?.prizes.find((item) => item.id === entry.prizeId)
          return {
            id: entry.id,
            caseId: entry.caseId,
            caseName: caseItem?.name ?? entry.caseId,
            prizeId: entry.prizeId,
            prizeName: prize?.name ?? entry.prizeId,
            prizeEmoji: prize?.emoji ?? '',
            prizeType: entry.prizeType,
            prizePrice: entry.prizePrice,
            isBetaMode: entry.isBetaMode,
            createdAt: entry.createdAt.toISOString(),
          }
        }),
        upgraderAttempts: upgraderAttempts.map((attempt) => ({
          ...attempt,
          userId: attempt.userId.toString(),
          createdAt: attempt.createdAt.toISOString(),
        })),
      }
    },
  )

  fastify.get('/api/admin/transactions', { preHandler: adminPreHandler }, async () => {
    const transactions = await prisma.transaction.findMany({
      where: { type: 'DEPOSIT', amount: { gt: 0 }, userId: { not: DEV_TELEGRAM_ID } },
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

  fastify.get('/api/admin/history', { preHandler: adminPreHandler }, async () => {
    const [deposits, rounds, caseOpens, upgraderAttempts] = await Promise.all([
      prisma.deposit.findMany({
        where: { status: 'completed', userId: { not: DEV_TELEGRAM_ID } },
        orderBy: { completedAt: 'desc' },
        take: 150,
      }),
      prisma.pvpRound.findMany({
        where: { status: 'finished' },
        orderBy: { finishedAt: 'desc' },
        take: 100,
        include: { participants: { where: { isBot: false, userId: { not: DEV_TELEGRAM_ID } } } },
      }),
      prisma.caseOpen.findMany({
        where: { userId: { not: DEV_TELEGRAM_ID } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { id: true, username: true, firstName: true } } },
      }),
      prisma.upgraderAttempt.findMany({
        where: { userId: { not: DEV_TELEGRAM_ID } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { id: true, username: true, firstName: true } } },
      }),
    ])

    const relatedUserIds = [...new Set([
      ...rounds.flatMap((round) => round.participants.map((participant) => participant.userId)),
      ...deposits.map((deposit) => deposit.userId),
    ])]
    const relatedUsers = await prisma.user.findMany({
      where: { id: { in: relatedUserIds } },
      select: { id: true, username: true, firstName: true },
    })
    const relatedUsersById = new Map(relatedUsers.map((user) => [user.id.toString(), user]))

    const depositEntries = deposits.flatMap((deposit) => {
      const user = relatedUsersById.get(deposit.userId.toString())
      if (!user) return []
      return [{
        id: deposit.id,
        userId: user.id.toString(),
        username: user.username,
        firstName: user.firstName,
        amount: deposit.amount,
        currency: deposit.currency,
        createdAt: (deposit.completedAt ?? deposit.createdAt).toISOString(),
      }]
    })

    const pvpEntries = rounds.flatMap((round) => round.participants.map((participant) => {
      const user = relatedUsersById.get(participant.userId.toString())
      const didWin = round.winnerId === participant.userId
      const refunded = round.winnerId === null
      const payout = didWin
        ? round.totalStars - round.rakeStars
        : refunded ? participant.stars : 0
      return {
        id: `${round.id}-${participant.id}`,
        roundId: round.id,
        userId: participant.userId.toString(),
        username: user?.username ?? participant.username,
        firstName: user?.firstName ?? (participant.isBot ? 'Бот' : 'Игрок'),
        betAmount: participant.stars,
        payoutAmount: payout,
        totalPot: round.totalStars,
        rakeStars: round.rakeStars,
        result: refunded
          ? `ВОЗВРАТ · возвращено ${participant.stars} ⭐`
          : didWin
            ? `ПОБЕДА · выплата ${payout} ⭐ · комиссия ${round.rakeStars} ⭐`
            : `ПРОИГРЫШ · ставка ${participant.stars} ⭐`,
        outcome: refunded ? 'REFUND' as const : didWin ? 'WIN' as const : 'LOSS' as const,
        createdAt: (round.finishedAt ?? round.createdAt).toISOString(),
      }
    }))

    const caseEntries = caseOpens.map((entry) => {
      const caseItem = allCases.find((item) => item.id === entry.caseId)
      const prize = caseItem?.prizes.find((item) => item.id === entry.prizeId)
      const prizeName = prize?.name ?? entry.prizeId
      const prizeLabel = entry.prizeType === 'BALANCE'
        ? `+${entry.prizePrice} ⭐`
        : `${prize?.emoji ?? '🎁'} ${prizeName} (${entry.prizePrice} ⭐)`
      return {
        id: `case-${entry.id}`,
        kind: 'CASE_OPEN' as const,
        userId: entry.user.id.toString(),
        username: entry.user.username,
        firstName: entry.user.firstName,
        title: `Кейс «${caseItem?.name ?? entry.caseId}» открыт`,
        casePrice: entry.isBetaMode ? 0 : caseItem?.price ?? 0,
        prizeName,
        prizeEmoji: prize?.emoji ?? '🎁',
        prizeType: entry.prizeType,
        prizePrice: entry.prizePrice,
        result: entry.isBetaMode ? `БЕТА · выпало бы: ${prizeLabel}` : `ВЫИГРАНО · ${prizeLabel}`,
        won: true,
        isBetaMode: entry.isBetaMode,
        createdAt: entry.createdAt.toISOString(),
      }
    })

    const upgradeEntries = upgraderAttempts.map((attempt) => ({
      id: `upgrade-${attempt.id}`,
      kind: 'UPGRADE' as const,
      userId: attempt.user.id.toString(),
      username: attempt.user.username,
      firstName: attempt.user.firstName,
      title: `Апгрейд · цель ${attempt.targetNftEmoji} ${attempt.targetNftName}`,
      betAmount: attempt.betAmount,
      targetNftName: attempt.targetNftName,
      targetNftEmoji: attempt.targetNftEmoji,
      targetNftPrice: attempt.targetNftPrice,
      winAmount: attempt.winAmount,
      chance: attempt.chance,
      result: attempt.win
        ? attempt.isBetaMode
          ? `БЕТА · выпал бы NFT за ${attempt.targetNftPrice} ⭐`
          : `ПОБЕДА · выпал NFT за ${attempt.targetNftPrice} ⭐, выплата ${attempt.winAmount} ⭐`
        : `${attempt.isBetaMode ? 'БЕТА · ' : ''}ПРОИГРЫШ · NFT не выпал`,
      won: attempt.win,
      isBetaMode: attempt.isBetaMode,
      createdAt: attempt.createdAt.toISOString(),
    }))

    return {
      deposits: depositEntries,
      pvp: pvpEntries.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 200),
      cases: caseEntries,
      upgrades: upgradeEntries,
    }
  })

  fastify.get('/api/admin/tasks', { preHandler: adminPreHandler }, async () => {
    const definitions = await getTaskDefinitions()
    return Promise.all(definitions.map(async (task) => ({
      ...task,
      channelUsername: task.channelUsername ?? null,
      completedByCount: await prisma.userTask.count({ where: { taskId: task.id } }),
      maxCompletions: task.maxCompletions ?? null,
      active: task.active !== false,
    })))
  })

  fastify.post('/api/admin/tasks', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = channelTaskSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Проверь канал, награду и лимит выполнений', code: 'VALIDATION_ERROR' })
    }

    const channelUsername = parsed.data.channelUsername.replace(/^@/, '')
    const id = `task-channel-${randomUUID()}`
    const title = parsed.data.title || `Подписка на @${channelUsername}`
    const task = await prisma.managedTask.create({
      data: {
        id,
        title,
        description: `Подпишись на @${channelUsername}`,
        reward: parsed.data.reward,
        emoji: '📢',
        type: 'channel_subscription',
        channelUsername,
        maxCompletions: parsed.data.maxCompletions,
        active: true,
      },
    })
    return reply.code(201).send({ ...task, completedByCount: 0 })
  })

  fastify.patch<{ Params: { id: string } }>(
    '/api/admin/tasks/:id',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const parsed = taskUpdateSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректные настройки задания', code: 'VALIDATION_ERROR' })
      }

      const current = await getTaskDefinition(request.params.id)
      if (!current) return reply.code(404).send({ error: 'Задание не найдено', code: 'TASK_NOT_FOUND' })

      const maxCompletions = 'maxCompletions' in parsed.data
        ? parsed.data.maxCompletions ?? null
        : current.maxCompletions ?? null
      const task = await prisma.managedTask.upsert({
        where: { id: current.id },
        create: {
          id: current.id,
          title: current.title,
          description: current.description,
          reward: parsed.data.reward ?? current.reward,
          emoji: current.emoji,
          type: current.type,
          target: current.target ?? null,
          channelUsername: current.channelUsername ?? null,
          maxCompletions,
          active: parsed.data.active ?? current.active ?? true,
        },
        update: {
          ...(parsed.data.reward !== undefined ? { reward: parsed.data.reward } : {}),
          ...('maxCompletions' in parsed.data ? { maxCompletions } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        },
      })
      const completedByCount = await prisma.userTask.count({ where: { taskId: current.id } })
      return { ...task, completedByCount }
    },
  )
}
