import type { GameCurrency } from '../api/types'

export interface DisplayRates {
  starsUsd: number
  tonUsd: number
}

/** Selected wallet units needed to equal one Telegram Star. */
export function currencyFactor(currency: GameCurrency, rates: DisplayRates): number {
  if (currency === 'STARS') return 1
  const usdPerStar = rates.starsUsd / 100
  return currency === 'GRAMS' ? usdPerStar / rates.tonUsd : usdPerStar
}

export function currencyPrecision(currency: GameCurrency): number {
  return currency === 'STARS' ? 0 : currency === 'GRAMS' ? 6 : 4
}

export function roundCurrency(amount: number, currency: GameCurrency): number {
  const scale = 10 ** currencyPrecision(currency)
  return Math.round((amount + Number.EPSILON) * scale) / scale
}

export function toCurrencyAmount(stars: number, currency: GameCurrency, factor: number): number {
  return roundCurrency(stars * factor, currency)
}

export function currencyUnit(currency: GameCurrency): string {
  if (currency === 'GRAMS') return 'Gram'
  if (currency === 'CRYPTO') return 'USD'
  return '⭐'
}

export function formatCurrency(amount: number, currency: GameCurrency): string {
  const digits = currencyPrecision(currency)
  const maximumFractionDigits = currency === 'STARS' ? 0 : Math.min(digits, 4)
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(amount)
  return currency === 'CRYPTO' ? `$${formatted}` : `${formatted} ${currencyUnit(currency)}`
}

export function balanceField(currency: GameCurrency): 'balance' | 'gramBalance' | 'cryptoBalance' {
  if (currency === 'GRAMS') return 'gramBalance'
  if (currency === 'CRYPTO') return 'cryptoBalance'
  return 'balance'
}
