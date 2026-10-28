import type { Prize } from '../data/cases.js'
import type { DailyBonusPrize } from '../data/dailyBonus.js'

/**
 * Выбирает приз из списка пропорционально полю `chance` (%).
 * Сумма chance в каждом кейсе равна 100%, roll лежит в [0, 100).
 * Функция чистая, без побочных эффектов.
 */
export function pickPrize(prizes: Prize[]): Prize {
  if (prizes.length === 0) {
    throw new Error('Список призов пуст')
  }

  const roll = Math.random() * 100
  let cumulative = 0

  for (const prize of prizes) {
    cumulative += prize.chance
    if (roll < cumulative) {
      return prize
    }
  }

  // Fallback на случай погрешности округления чисел с плавающей точкой
  return prizes[prizes.length - 1]!
}

/**
 * Выбирает приз ежедневного бонуса на основе вероятностей chance.
 * Призы типа NFT имеют chance = 0, поэтому никогда не возвращаются.
 */
export function pickDailyBonusPrize(prizes: DailyBonusPrize[]): DailyBonusPrize {
  const roll = Math.random() * 100
  let cumulative = 0
  for (const prize of prizes) {
    cumulative += prize.chance
    if (roll < cumulative) {
      return prize
    }
  }
  // Fallback — минимальный приз (1⭐)
  return prizes[0]!
}
