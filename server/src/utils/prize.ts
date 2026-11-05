import type { Prize } from '../data/cases.js'
import type { DailyBonusPrize } from '../data/dailyBonus.js'

/**
 * Выбирает приз пропорционально полю `chance` (%). Если задан множитель,
 * он применяется к призам с шансом до 10%, а веса нормализуются общей суммой.
 * Функция чистая, без побочных эффектов.
 */
export function pickPrize(prizes: Prize[], rarePrizeMultiplier = 1): Prize {
  if (prizes.length === 0) {
    throw new Error('Список призов пуст')
  }

  const weights = prizes.map((prize) =>
    prize.chance > 0 && prize.chance <= 10 ? prize.chance * rarePrizeMultiplier : prize.chance,
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const roll = Math.random() * totalWeight
  let cumulative = 0

  for (const [index, prize] of prizes.entries()) {
    cumulative += weights[index] ?? 0
    if (roll < cumulative) {
      return prize
    }
  }

  // Fallback на случай погрешности округления чисел с плавающей точкой:
  // берём последний приз с ненулевым шансом, чтобы 0%-приз (например,
  // декоративный NFT или Sakura Flower) не выпал из-за арифметики.
  for (let index = prizes.length - 1; index >= 0; index -= 1) {
    const prize = prizes[index]!
    if (prize.chance > 0) {
      return prize
    }
  }

  return prizes[0]!
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
  // Fallback — первый приз пула (самый маленький ежедневный бонус).
  return prizes[0]!
}
