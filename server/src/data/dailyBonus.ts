export interface DailyBonusPrize {
  id: string
  label: string // '10', '20', '50', 'NFT'
  emoji: string // '⭐', '⭐', '⭐', '🍦'
  amount: number // 10, 20, 50 — для NFT ставим 0
  chance: number // сумма шансов BALANCE-призов — 100%, для NFT 0
  type: 'BALANCE' | 'NFT'
}

export const MIN_DAILY_BONUS_STARS = 1

export const dailyBonusPrizes: DailyBonusPrize[] = [
  { id: 'db-1', label: '1', emoji: '⭐', amount: 1, chance: 45, type: 'BALANCE' },
  { id: 'db-5', label: '5', emoji: '⭐', amount: 5, chance: 30, type: 'BALANCE' },
  { id: 'db-10', label: '10', emoji: '⭐', amount: 10, chance: 15, type: 'BALANCE' },
  { id: 'db-25', label: '25', emoji: '⭐', amount: 25, chance: 8, type: 'BALANCE' },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, chance: 2, type: 'BALANCE' },
  // Декоративный NFT — chance = 0, никогда не выигрывает. Нужен только для отображения в ленте.
  { id: 'db-nft', label: 'NFT', emoji: '🍦', amount: 0, chance: 0, type: 'NFT' },
]

// Валидация при импорте: сумма chance по BALANCE-призам строго равна 100%. NFT не учитывается.
const sum = dailyBonusPrizes
  .filter((p) => p.type === 'BALANCE')
  .reduce((s, p) => s + p.chance, 0)

const belowMinimum = dailyBonusPrizes.find(
  (p) => p.type === 'BALANCE' && p.amount < MIN_DAILY_BONUS_STARS,
)

if (belowMinimum) {
  throw new Error(
    `[dailyBonus] Приз ${belowMinimum.id} меньше минимального бонуса ${MIN_DAILY_BONUS_STARS} ⭐`,
  )
}

if (Math.abs(sum - 100) > 0.001) {
  throw new Error(`[dailyBonus] Сумма chance должна быть 100, сейчас ${sum}`)
}
