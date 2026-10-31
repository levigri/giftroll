import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'
import { findTask, tasks, type TaskType } from '../data/tasks.js'
import { checkChannelSubscription } from '../services/bot.js'
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
  type: TaskType,
  forceFreshNickname: boolean,
): Promise<TaskCompletion> {
  switch (type) {
    case 'channel_subscription':
      return { completed: await checkChannelSubscription(userId) }
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

    return {
      tasks: await Promise.all(
        tasks.map(async (task) => {
          const completion = await checkTaskCompletion(user.id, task.type, false)
          const completedByCount = await prisma.userTask.count({ where: { taskId: task.id } })
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
        const task = findTask(request.params.id)
        if (!task) throw new GameError('TASK_NOT_FOUND', 'Задание не найдено', 404)

        const completion = await checkTaskCompletion(user.id, task.type, true)
        if (!completion.completed) {
          throw new GameError('TASK_NOT_COMPLETED', 'Задание ещё не выполнено', 403)
        }

        const newBalance = await prisma.$transaction(async (tx) => {
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
