import { tasks, type TaskDefinition, type TaskType } from '../data/tasks.js'
import { prisma } from '../db/prisma.js'

const TASK_TYPES: readonly TaskType[] = [
  'channel_subscription',
  'amateur_case',
  'nickname_streak',
  'first_upgrade',
  'first_pvp',
  'daily_streak_7',
  'active_referral',
]

function isTaskType(value: string): value is TaskType {
  return TASK_TYPES.includes(value as TaskType)
}

export async function getTaskDefinitions(): Promise<TaskDefinition[]> {
  const managedTasks = await prisma.managedTask.findMany()
  const managedById = new Map(managedTasks.map((task) => [task.id, task]))
  const builtInIds = new Set(tasks.map((task) => task.id))

  const builtInTasks = tasks.map((task) => {
    const managed = managedById.get(task.id)
    if (!managed) return { ...task, active: true, maxCompletions: null }

    return {
      ...task,
      title: managed.title,
      description: managed.description,
      reward: managed.reward,
      emoji: managed.emoji,
      target: managed.target ?? undefined,
      channelUsername: managed.channelUsername,
      maxCompletions: managed.maxCompletions,
      active: managed.active,
    }
  })

  const dynamicTasks: TaskDefinition[] = managedTasks
    .filter((task) => !builtInIds.has(task.id) && isTaskType(task.type))
    .map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      reward: task.reward,
      emoji: task.emoji,
      type: task.type as TaskType,
      target: task.target ?? undefined,
      channelUsername: task.channelUsername,
      maxCompletions: task.maxCompletions,
      active: task.active,
    }))

  return [...builtInTasks, ...dynamicTasks]
}

export async function getTaskDefinition(id: string): Promise<TaskDefinition | undefined> {
  return (await getTaskDefinitions()).find((task) => task.id === id)
}
