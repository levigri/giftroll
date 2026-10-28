import type { CaseItem, Prize } from '../data/cases'

/**
 * Выбирает приз из списка пропорционально полю `chance` (%).
 * Сумма chance в каждом кейсе равна 100, поэтому roll лежит в [0, 100).
 */
export function pickPrize(prizes: Prize[]): Prize {
  if (prizes.length === 0) {
    throw new Error('Список призов пуст')
  }

  const roll = Math.random() * 100
  let cumulative = 0

  for (const prize of prizes) {
    cumulative += prize.chance ?? 0
    if (roll < cumulative) {
      return prize
    }
  }

  // Запасной вариант на случай ошибок округления при суммировании процентов.
  return prizes[prizes.length - 1]
}

/** Случайный кейс из списка. */
export function pickCase(cases: CaseItem[] = []): CaseItem {
  const target = cases[Math.floor(Math.random() * cases.length)]
  if (!target) {
    throw new Error('Список кейсов пуст')
  }
  return target
}
