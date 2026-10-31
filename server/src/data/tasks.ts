export type TaskType =
  | 'channel_subscription'
  | 'amateur_case'
  | 'nickname_streak'
  | 'first_upgrade'
  | 'first_pvp'
  | 'daily_streak_7'
  | 'active_referral'

export interface TaskDefinition {
  id: string
  title: string
  description: string
  reward: number
  emoji: string
  type: TaskType
  target?: number
}

export const tasks: TaskDefinition[] = [
  {
    id: 'task-channel',
    title: 'Подписка на канал',
    description: 'Подпишись на @NewsGiftRoll',
    reward: 5,
    emoji: '📢',
    type: 'channel_subscription',
  },
  {
    id: 'task-amateur-case',
    title: 'Кейс «Любитель»',
    description: 'Открой кейс «Любитель» за 100 ⭐',
    reward: 5,
    emoji: '📦',
    type: 'amateur_case',
  },
  {
    id: 'task-first-upgrade',
    title: 'Первый апгрейд',
    description: 'Сделай ставку в Апгрейдере',
    reward: 5,
    emoji: '⚡',
    type: 'first_upgrade',
  },
  {
    id: 'task-first-pvp',
    title: 'Первая PvP',
    description: 'Зайди в раунд «Рулетки на толпу»',
    reward: 5,
    emoji: '⚔️',
    type: 'first_pvp',
  },
  {
    id: 'task-daily-7',
    title: '7 дней подряд',
    description: 'Забери ежедневный бонус 7 дней подряд',
    reward: 20,
    emoji: '🔥',
    type: 'daily_streak_7',
    target: 7,
  },
  {
    id: 'task-nickname',
    title: 'GiftRoll в нике',
    description: 'Держи GiftRoll в имени профиля 7 дней подряд',
    reward: 50,
    emoji: '✏️',
    type: 'nickname_streak',
    target: 7,
  },
  {
    id: 'task-active-referral',
    title: 'Активный реферал',
    description: 'Твой друг откроет хотя бы один кейс',
    reward: 15,
    emoji: '👥',
    type: 'active_referral',
  },
]

export function findTask(id: string): TaskDefinition | undefined {
  return tasks.find((task) => task.id === id)
}
