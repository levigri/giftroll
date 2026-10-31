export type TaskType = 'channel_subscription' | 'nickname' | 'first_case'

export interface TaskDefinition {
  id: string
  title: string
  description: string
  reward: number
  emoji: string
  type: TaskType
}

export const tasks: TaskDefinition[] = [
  {
    id: 'task-channel',
    title: 'Подписка на канал',
    description: 'Подпишись на @NewsGiftRoll',
    reward: 50,
    emoji: '📢',
    type: 'channel_subscription',
  },
  {
    id: 'task-nickname',
    title: 'GiftRoll в ник',
    description: 'Поставь GiftRoll в имя профиля Telegram',
    reward: 100,
    emoji: '✏️',
    type: 'nickname',
  },
  {
    id: 'task-first-case',
    title: 'Первый кейс',
    description: 'Открой любой кейс',
    reward: 100,
    emoji: '🎁',
    type: 'first_case',
  },
]

export function findTask(id: string): TaskDefinition | undefined {
  return tasks.find((task) => task.id === id)
}
