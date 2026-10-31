import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { prisma } from '../db/prisma.js'
import { findTask, tasks, type TaskType } from '../data/tasks.js'
import { checkChannelSubscription, checkNicknameContainsGiftRoll } from '../services/bot.js'
import { GameError } from '../services/game.js'
import { logTransaction } from '../services/transaction.js'

async function isTaskCompleted(userId: bigint, type: TaskType): Promise<boolean> {
  switch (type) {
    case 'channel_subscription':
      return checkChannelSubscription(userId)
    case 'nickname':
      return checkNicknameContainsGiftRoll(userId)
    case 'first_case':
      return (await prisma.caseOpen.count({ where: { userId } })) > 0
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
    const completionCache = new Map<TaskType, Promise<boolean>>()
    const getCompleted = (type: TaskType): Promise<boolean> => {
      let result = completionCache.get(type)
      if (!result) {
        result = isTaskCompleted(user.id, type)
        completionCache.set(type, result)
      }
      return result
    }

    return {
      tasks: await Promise.all(
        tasks.map(async (task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          reward: task.reward,
          emoji: task.emoji,
          completed: await getCompleted(task.type),
          claimed: claimedIds.has(task.id),
        })),
      ),
    }
  })

  fastify.post<{ Params: { id: string } }>(
    '/api/tasks/:id/claim',
    { preHandler: authenticateTelegram },
    async (request, reply) => {
      const user = request.telegramUser
      if (!user) return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })

      const task = findTask(request.params.id)
      if (!task) return reply.code(404).send({ error: 'Задание не найдено', code: 'TASK_NOT_FOUND' })

      if (!(await isTaskCompleted(user.id, task.type))) {
        return reply.code(403).send({ error: 'Задание ещё не выполнено', code: 'TASK_NOT_COMPLETED' })
      }

      try {
        return await prisma.$transaction(async (tx) => {
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
          return { ok: true, reward: task.reward, newBalance: updated.balance }
        })
      } catch (err) {
        if (err instanceof GameError) {
          return reply.code(err.statusCode).send({ error: err.message, code: err.code })
        }
        throw err
      }
    },
  )
}
