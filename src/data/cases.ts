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

export const DEPOSIT_BONUS_CASE: CaseItem = {
  id: 'case-deposit-bonus',
  name: 'Бонусный кейс',
  price: 0,
  currency: 'STARS',
  emoji: '💎',
  prizes: [
    { id: 'db-10', name: '+10', emoji: '⭐', type: 'BALANCE', price: 10, chance: 55 },
    { id: 'db-20', name: '+20', emoji: '⭐', type: 'BALANCE', price: 20, chance: 30 },
    { id: 'db-50', name: '+50', emoji: '⭐', type: 'BALANCE', price: 50, chance: 14.8 },
    { id: 'ice-cream', name: 'Ice Cream', emoji: '🍦', type: 'NFT', price: 364, chance: 0.1 },
    { id: 'clover-pin', name: 'Clover Pin', emoji: '🍀', type: 'NFT', price: 480, chance: 0.1 },
    { id: 'sakura-flower', name: 'Sakura Flower', emoji: '🌸', type: 'NFT', price: 1040, chance: 0 },
  ],
}
