import { CircleDollarSign, Star } from 'lucide-react'
import type { GameCurrency } from '../api/types'

export default function CurrencyIcon({ currency, size = 15 }: { currency: GameCurrency; size?: number }) {
  if (currency === 'GRAMS') {
    return <img src="/gram-icon.png" alt="" width={size} height={size} className="shrink-0 rounded-full object-contain" />
  }
  if (currency === 'CRYPTO') {
    return <CircleDollarSign size={size} className="shrink-0 text-emerald-400" aria-hidden="true" />
  }
  return <Star size={size} className="shrink-0 text-[#FFD700]" fill="currentColor" aria-hidden="true" />
}
