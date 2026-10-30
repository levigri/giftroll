export interface DailyBonusPrize {
  id: string
  label: string // '10', '20', '50', 'NFT'
  emoji: string // '⭐', '⭐', '⭐', '🍦'
  amount: number // 10, 20, 50 — для NFT ставим 0
  chance: number // 70, 25, 5 — для NFT 0
  type: 'BALANCE' | 'NFT'
}

export const dailyBonusPrizes: DailyBonusPrize[] = [
  { id: 'db-10', label: '10', emoji: '⭐', amount: 10, chance: 70.0, type: 'BALANCE' },
  { id: 'db-20', label: '20', emoji: '⭐', amount: 20, chance: 25.0, type: 'BALANCE' },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, chance: 5.0, type: 'BALANCE' },
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
