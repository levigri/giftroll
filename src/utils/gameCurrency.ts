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
  const formatted = formatCurrencyValue(amount, currency)
  return currency === 'CRYPTO' ? `$${formatted}` : `${formatted} ${currencyUnit(currency)}`
}

/** Compact amount for wallet badges and game prices. Values retain full precision internally. */
export function formatCurrencyValue(amount: number, currency: GameCurrency): string {
  const maximumFractionDigits = currency === 'STARS' ? 0 : 2
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(amount)
}

export function currencyColorClass(currency: GameCurrency): string {
  if (currency === 'GRAMS') return 'currency-tone currency-tone--grams'
  if (currency === 'CRYPTO') return 'currency-tone currency-tone--crypto'
  return 'currency-tone currency-tone--stars'
}

export function balanceField(currency: GameCurrency): 'balance' | 'gramBalance' | 'cryptoBalance' {
  if (currency === 'GRAMS') return 'gramBalance'
  if (currency === 'CRYPTO') return 'cryptoBalance'
  return 'balance'
}
