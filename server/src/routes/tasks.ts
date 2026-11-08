import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'
import type { TaskDefinition } from '../data/tasks.js'
import { checkChannelSubscription } from '../services/bot.js'
import { getTaskDefinition, getTaskDefinitions } from '../services/taskDefinitions.js'
import { checkNicknameTask } from '../services/nickname.js'
import { GameError } from '../services/game.js'
import { logTransaction } from '../services/transaction.js'

const DAILY_STREAK_TARGET = 7

interface TaskCompletion {
  completed: boolean
  progressCurrent?: number
  progressTarget?: number
}

async function getDailyStreak(userId: bigint): Promise<number> {
  const row = await prisma.dailyBonus.findUnique({ where: { userId }, select: { streak: true } })
  return row?.streak ?? 0
}

async function checkTaskCompletion(
  userId: bigint,
  task: TaskDefinition,
  forceFreshNickname: boolean,
): Promise<TaskCompletion> {
  switch (task.type) {
    case 'channel_subscription':
      return { completed: await checkChannelSubscription(userId, task.channelUsername ?? undefined) }
    case 'amateur_case': {
      const count = await prisma.caseOpen.count({ where: { userId, caseId: 'case-amateur' } })
      return { completed: count > 0 }
    }
    case 'first_upgrade': {
      const count = await prisma.transaction.count({ where: { userId, type: 'UPGRADE' } })
      return { completed: count > 0 }
    }
    case 'first_pvp': {
      const count = await prisma.pvpParticipant.count({ where: { userId } })
      return { completed: count > 0 }
    }
    case 'daily_streak_7': {
      const streak = await getDailyStreak(userId)
      return {
        completed: streak >= DAILY_STREAK_TARGET,
        progressCurrent: Math.min(streak, DAILY_STREAK_TARGET),
        progressTarget: DAILY_STREAK_TARGET,
      }
    }
    case 'nickname_streak': {
      const { streak } = await checkNicknameTask(userId, forceFreshNickname)
      return {
        completed: streak >= 7,
        progressCurrent: Math.min(streak, 7),
        progressTarget: 7,
      }
    }
    case 'active_referral': {
      const count = await prisma.user.count({
        where: {
          referredBy: userId,
          OR: [{ caseOpens: { some: {} } }, { dailyBonus: { isNot: null } }],
        },
      })
      return { completed: count > 0 }
    }
  }
}

export const tasksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/tasks', { preHandler: authenticateTelegram }, async (request, reply) => {
    const user = request.telegramUser
    if (!user) return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })

    const claimedRows = await prisma.userTask.findMany({
      where: { userId: user.id },
      select: { taskId: true },
    })
    const claimedIds = new Set(claimedRows.map((row) => row.taskId))
    const availableTasks = (await getTaskDefinitions()).filter((task) => task.active !== false)

    return {
      tasks: await Promise.all(
        availableTasks.map(async (task) => {
          const completion = await checkTaskCompletion(user.id, task, false)
          const completedByCount = await prisma.userTask.count({ where: { taskId: task.id } })
          const available = task.maxCompletions == null || completedByCount < task.maxCompletions
          return {
            id: task.id,
            title: task.title,
            description: task.description,
            reward: task.reward,
            emoji: task.emoji,
            completed: completion.completed,
            claimed: claimedIds.has(task.id),
            progressCurrent: completion.progressCurrent,
            progressTarget: completion.progressTarget,
            completedByCount,
            maxCompletions: task.maxCompletions ?? null,
            available,
            type: task.type,
            channelUsername: task.channelUsername ?? null,
          }
        }),
      ),
    }
  })

  fastify.post<{ Params: { id: string } }>(
    '/api/tasks/:id/claim',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })

      try {
        const task = await getTaskDefinition(request.params.id)
        if (!task) throw new GameError('TASK_NOT_FOUND', 'Задание не найдено', 404)
        if (task.active === false) throw new GameError('TASK_INACTIVE', 'Задание больше недоступно', 403)

        const completion = await checkTaskCompletion(user.id, task, true)
        if (!completion.completed) {
          throw new GameError('TASK_NOT_COMPLETED', 'Задание ещё не выполнено', 403)
        }

        const newBalance = await prisma.$transaction(async (tx) => {
          if (task.maxCompletions != null) {
            await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM managed_tasks WHERE id = ${task.id} FOR UPDATE
            `
            const completedCount = await tx.userTask.count({ where: { taskId: task.id } })
            if (completedCount >= task.maxCompletions) {
              throw new GameError('TASK_LIMIT_REACHED', 'Лимит выполнений задания уже достигнут', 409)
            }
          }

          try {
            await tx.userTask.create({ data: { userId: user.id, taskId: task.id } })
          } catch (err) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
              throw new GameError('ALREADY_CLAIMED', 'Награда уже получена', 400)
            }
            throw err
          }

          const updated = await tx.user.update({
            where: { id: user.id },
            data: { balance: { increment: task.reward } },
            select: { balance: true },
          })
          await logTransaction(user.id, 'TASK_REWARD', task.reward, `Задание: ${task.title}`, tx)
          return updated.balance
        })

        return { ok: true, reward: task.reward, newBalance }
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )
}
