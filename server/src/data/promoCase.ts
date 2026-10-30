import type { DailyBonusPrize } from './dailyBonus.js'

export const promoCasePrizes: DailyBonusPrize[] = [
  { id: 'p-1', label: '1', emoji: '⭐', amount: 1, chance: 55, type: 'BALANCE' },
  { id: 'p-5', label: '5', emoji: '⭐', amount: 5, chance: 25, type: 'BALANCE' },
  { id: 'p-10', label: '10', emoji: '⭐', amount: 10, chance: 12, type: 'BALANCE' },
  { id: 'p-20', label: '20', emoji: '⭐', amount: 20, chance: 6, type: 'BALANCE' },
  { id: 'p-50', label: '50', emoji: '⭐', amount: 50, chance: 1.9, type: 'BALANCE' },
  { id: 'p-ice', label: 'Ice Cream', emoji: '🍦', amount: 0, chance: 0.1, type: 'NFT' },
  { id: 'p-clover', label: 'Clover Pin', emoji: '🍀', amount: 0, chance: 0, type: 'NFT' },
  { id: 'p-sakura', label: 'Sakura Flower', emoji: '🌸', amount: 0, chance: 0, type: 'NFT' },
]

const totalChance = promoCasePrizes.reduce((sum, prize) => sum + prize.chance, 0)
if (Math.abs(totalChance - 100) > 0.001) {
  throw new Error(`[promoCase] Сумма шансов должна быть 100, сейчас ${totalChance}`)
}
