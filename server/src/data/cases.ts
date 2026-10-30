import { nftCatalog } from './nftCatalog.js'

export interface Prize {
  id: string
  name: string
  emoji: string
  type: 'NFT' | 'BALANCE'
  price: number // в Stars для STARS-кейсов, в TON для TON-кейсов
  chance: number // % — сумма всех chance в кейсе = 100
}

export interface CaseItem {
  id: string
  name: string
  price: number
  currency: 'STARS' | 'TON'
  emoji: string
  /** Цена в TON при оплате TON (курс 1 TON = 100⭐). */
  tonPrice?: number
  prizes: Prize[]
}

export const allCases: CaseItem[] = [
  // Стартовый — 20 STARS
  {
    id: 'case-start',
    name: 'Стартовый',
    price: 20,
    currency: 'STARS',
    emoji: '🎁',
    prizes: [
      { id: 'case-start-1', name: '+5', emoji: '⭐', type: 'BALANCE', price: 5, chance: 40 },
      { id: 'case-start-2', name: '+10', emoji: '⭐', type: 'BALANCE', price: 10, chance: 30 },
      { id: 'case-start-3', name: '+20', emoji: '⭐', type: 'BALANCE', price: 20, chance: 20 },
      { id: 'case-start-4', name: '+50', emoji: '⭐', type: 'BALANCE', price: 50, chance: 6.5 },
      { id: 'case-start-5', name: '+100', emoji: '⭐', type: 'BALANCE', price: 100, chance: 3 },
      { id: 'case-start-6', name: '+200', emoji: '⭐', type: 'BALANCE', price: 200, chance: 0.5 },
    ],
  },

  // Любитель — 100 STARS
  {
    id: 'case-amateur',
    name: 'Любитель',
    price: 100,
    currency: 'STARS',
    emoji: '📦',
    prizes: [
      { id: 'case-amateur-1', name: '+50', emoji: '⭐', type: 'BALANCE', price: 50, chance: 45 },
      { id: 'case-amateur-2', name: '+80', emoji: '⭐', type: 'BALANCE', price: 80, chance: 36 },
      { id: 'case-amateur-3', name: '+100', emoji: '⭐', type: 'BALANCE', price: 100, chance: 12.5 },
      { id: 'case-amateur-4', name: '+150', emoji: '⭐', type: 'BALANCE', price: 150, chance: 2.5 },
      { id: 'case-amateur-5', name: '+200', emoji: '⭐', type: 'BALANCE', price: 200, chance: 1 },
      { id: 'lol-pop', name: 'Lol Pop', emoji: '🍭', type: 'NFT', price: 378, chance: 1.2 },
      { id: 'fresh-socks', name: 'Fresh Socks', emoji: '🧦', type: 'NFT', price: 400, chance: 1 },
      { id: 'santa-hat', name: 'Santa Hat', emoji: '🎅', type: 'NFT', price: 540, chance: 0.8 },
    ],
  },

  // Профи — 500 STARS
  {
    id: 'case-pro',
    name: 'Профи',
    price: 500,
    currency: 'STARS',
    emoji: '🎯',
    prizes: [
      { id: 'case-pro-1', name: '+150', emoji: '⭐', type: 'BALANCE', price: 150, chance: 35 },
      { id: 'case-pro-2', name: '+200', emoji: '⭐', type: 'BALANCE', price: 200, chance: 20 },
      { id: 'case-pro-3', name: '+350', emoji: '⭐', type: 'BALANCE', price: 350, chance: 14 },
      { id: 'case-pro-4', name: '+500', emoji: '⭐', type: 'BALANCE', price: 500, chance: 10 },
      { id: 'surge-board', name: 'Surge Board', emoji: '🏄', type: 'NFT', price: 650, chance: 8 },
      { id: 'berry-box', name: 'Berry Box', emoji: '🍓', type: 'NFT', price: 860, chance: 6 },
      { id: 'top-hat', name: 'Top Hat', emoji: '🎩', type: 'NFT', price: 1040, chance: 4 },
      { id: 'flying-broom', name: 'Flying Broom', emoji: '🧹', type: 'NFT', price: 1240, chance: 2 },
      { id: 'diamond-ring', name: 'Diamond Ring', emoji: '💍', type: 'NFT', price: 3150, chance: 1 },
    ],
  },

  // Охотник — 1000 STARS
  {
    id: 'case-hunter',
    name: 'Охотник',
    price: 1000,
    currency: 'STARS',
    emoji: '🏹',
    prizes: [
      { id: 'pool-float', name: 'Pool Float', emoji: '🦩', type: 'NFT', price: 360, chance: 50 },
      { id: 'bow-tie', name: 'Bow Tie', emoji: '🎀', type: 'NFT', price: 580, chance: 24 },
      { id: 'joyful-bundle', name: 'Joyful Bundle', emoji: '🎁', type: 'NFT', price: 784, chance: 10 },
      { id: 'record-player', name: 'Record Player', emoji: '📻', type: 'NFT', price: 1280, chance: 7 },
      { id: 'ufc-strike', name: 'UFC Strike', emoji: '🥊', type: 'NFT', price: 1620, chance: 4 },
      { id: 'cupid-charm', name: 'Cupid Charm', emoji: '🏹', type: 'NFT', price: 2200, chance: 2.5 },
      { id: 'diamond-ring', name: 'Diamond Ring', emoji: '💍', type: 'NFT', price: 3150, chance: 1.5 },
      { id: 'artisan-brick', name: 'Artisan Brick', emoji: '🧱', type: 'NFT', price: 6290, chance: 0.7 },
      { id: 'durovs-glasses', name: "Durov's Glasses", emoji: '👓', type: 'NFT', price: 9480, chance: 0.3 },
    ],
  },

  // Легенда — 5000 STARS
  {
    id: 'case-legend',
    name: 'Легенда',
    price: 5000,
    currency: 'STARS',
    emoji: '👑',
    prizes: [
      { id: 'crystal-ball', name: 'Crystal Ball', emoji: '🔮', type: 'NFT', price: 1250, chance: 28 },
      { id: 'bling-binky', name: 'Bling Binky', emoji: '🍼', type: 'NFT', price: 2530, chance: 30 },
      { id: 'voodoo-doll', name: 'Voodoo Doll', emoji: '🧸', type: 'NFT', price: 3610, chance: 18 },
      { id: 'perfume-bottle', name: 'Perfume Bottle', emoji: '🧴', type: 'NFT', price: 6890, chance: 12 },
      { id: 'artisan-brick', name: 'Artisan Brick', emoji: '🧱', type: 'NFT', price: 8100, chance: 6 },
      { id: 'durovs-glasses', name: "Durov's Glasses", emoji: '👓', type: 'NFT', price: 9480, chance: 3 },
      { id: 'mighty-arm', name: 'Mighty Arm', emoji: '💪', type: 'NFT', price: 12300, chance: 2 },
      { id: 'heroic-helmet', name: 'Heroic Helmet', emoji: '🪖', type: 'NFT', price: 17690, chance: 0.8 },
      { id: 'durovs-cap', name: "Durov's Cap", emoji: '🧢', type: 'NFT', price: 39900, chance: 0.2 },
    ],
  },
]

// Валидация при импорте: проверяем, что сумма всех chance в каждом кейсе ровно 100%
for (const c of allCases) {
  const totalChance = c.prizes.reduce((sum, p) => sum + p.chance, 0)
  if (Math.abs(totalChance - 100) > 0.001) {
    throw new Error(
      `[Cases] Invalid configuration for case "${c.id}": total chance is ${totalChance}%, expected 100%`,
    )
  }
}

/**
 * Бонусный кейс за депозит от 200 ⭐ — открывается только через
 * `POST /api/daily-bonus/claim-deposit` (`claimFreeCase` в game.ts).
 *
 * Сознательно НЕ входит в `allCases`: цена 0, иначе игрок мог бы открывать
 * его бесконечно и бесплатно через обычный `/api/open-case`.
 */
export const depositBonusCase: CaseItem = {
  id: 'case-deposit-bonus',
  name: 'Бонусный кейс',
  price: 0,
  currency: 'STARS',
  emoji: '💎',
  prizes: [
    { id: 'db-10', name: '+10', emoji: '⭐', type: 'BALANCE', price: 10, chance: 55 },
    { id: 'db-20', name: '+20', emoji: '⭐', type: 'BALANCE', price: 20, chance: 20 },
    { id: 'db-50', name: '+50', emoji: '⭐', type: 'BALANCE', price: 50, chance: 24.8 },
    { id: 'ice-cream', name: 'Ice Cream', emoji: '🍦', type: 'NFT', price: 364, chance: 0.1 },
    { id: 'clover-pin', name: 'Clover Pin', emoji: '🍀', type: 'NFT', price: 480, chance: 0.1 },
    { id: 'sakura-flower', name: 'Sakura Flower', emoji: '🌸', type: 'NFT', price: 1040, chance: 0 },
  ],
}

// Сумма шансов бонусного кейса (включая NFT) — тоже строго 100%.
{
  const totalChance = depositBonusCase.prizes.reduce((sum, p) => sum + p.chance, 0)
  if (Math.abs(totalChance - 100) > 0.001) {
    throw new Error(
      `[Cases] Invalid configuration for case "${depositBonusCase.id}": total chance is ${totalChance}%, expected 100%`,
    )
  }
}

export function findCase(id: string): CaseItem | undefined {
  return allCases.find((c) => c.id === id)
}

export function findPrize(caseId: string, prizeId: string): Prize | undefined {
  const c = findCase(caseId)
  return c?.prizes.find((p) => p.id === prizeId)
}

/**
 * Первый NFT-приз с таким id. Один prizeId встречается в нескольких кейсах
 * (иногда с разной ценой), поэтому берём первое вхождение — так же дедуплицирует
 * и клиент, чтобы шанс в интерфейсе совпадал с серверной выдачей.
 *
 * После кейсов ищем в каталоге апгрейдера: его предметы не выпадают из кейсов,
 * но должны находиться по targetNftId.
 */
export function findNftPrize(prizeId: string): Prize | undefined {
  for (const c of allCases) {
    const prize = c.prizes.find((p) => p.id === prizeId && p.type === 'NFT')
    if (prize) {
      return prize
    }
  }

  return nftCatalog.find((prize) => prize.id === prizeId)
}
