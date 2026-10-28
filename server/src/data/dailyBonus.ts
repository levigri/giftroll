export interface DailyBonusPrize {
  id: string
  label: string // '1', '5', '25', '50', 'NFT'
  emoji: string // '⭐', '⭐', '⭐', '⭐', '🍦'
  amount: number // 1, 5, 25, 50 — для NFT ставим 0
  chance: number // 85, 12, 2.5, 0.5 — для NFT 0
  type: 'BALANCE' | 'NFT'
}

export const dailyBonusPrizes: DailyBonusPrize[] = [
  { id: 'db-1', label: '1', emoji: '⭐', amount: 1, chance: 85.0, type: 'BALANCE' },
  { id: 'db-5', label: '5', emoji: '⭐', amount: 5, chance: 12.0, type: 'BALANCE' },
  { id: 'db-25', label: '25', emoji: '⭐', amount: 25, chance: 2.5, type: 'BALANCE' },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, chance: 0.5, type: 'BALANCE' },
  // Декоративный NFT — chance = 0, никогда не выигрывает. Нужен только для отображения в ленте.
  { id: 'db-nft', label: 'NFT', emoji: '🍦', amount: 0, chance: 0, type: 'NFT' },
]

// Валидация при импорте: сумма chance по BALANCE-призам строго равна 100%. NFT не учитывается.
const sum = dailyBonusPrizes
  .filter((p) => p.type === 'BALANCE')
  .reduce((s, p) => s + p.chance, 0)

if (Math.abs(sum - 100) > 0.001) {
  throw new Error(`[dailyBonus] Сумма chance должна быть 100, сейчас ${sum}`)
}
