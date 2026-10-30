export interface Prize {
  id: string
  name: string
  emoji: string
  type: 'NFT' | 'BALANCE'
  price: number
  chance?: number
}

export interface CaseItem {
  id: string
  name: string
  price: number
  currency: 'STARS' | 'TON'
  emoji: string
  tonPrice?: number
  prizes: Prize[]
  /** Опциональная картинка кейса (если бэкенд её присылает). */
  imageUrl?: string
}

/**
 * Бонусные «кейсы» — живут только в интерфейсе (сетка кейсов и их модалки).
 * В серверный `allCases` они сознательно НЕ добавлены: иначе стали бы обычными
 * покупаемыми кейсами с нулевой ценой (открытая дыра в балансе).
 */
export const FREE_CASE = {
  id: 'free-case',
  name: 'Бесплатный кейс',
  emoji: '🎁',
} as const

export const DEPOSIT_BONUS_CASE = {
  id: 'deposit-bonus',
  name: 'Бонусный кейс за депозит',
  emoji: '💎',
} as const
