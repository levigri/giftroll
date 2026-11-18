import { getGramRate, getStarsBasePriceUsd } from './rates.js'

export type GameCurrency = 'STARS' | 'GRAMS' | 'CRYPTO'

export interface CurrencyBalances {
  balance: number
  gramBalance: number
  cryptoBalance: number
}

/** Amount of the selected wallet currency equivalent to one Star. */
export async function getCurrencyFactor(currency: GameCurrency): Promise<number> {
  if (currency === 'STARS') return 1
  const oneStarUsd = getStarsBasePriceUsd(1)
  if (currency === 'CRYPTO') return oneStarUsd
  const tonUsd = await getGramRate()
  return oneStarUsd / tonUsd
}

export function roundCurrencyAmount(amount: number, currency: GameCurrency): number {
  const precision = currency === 'STARS' ? 0 : currency === 'GRAMS' ? 6 : 4
  const scale = 10 ** precision
  return Math.round((amount + Number.EPSILON) * scale) / scale
}

export function starsToCurrencyAmount(
  stars: number,
  currency: GameCurrency,
  factor: number,
): number {
  return roundCurrencyAmount(stars * factor, currency)
}

export function currencyToStarsAmount(amount: number, factor: number): number {
  return amount / factor
}

export function balanceForCurrency(balances: CurrencyBalances, currency: GameCurrency): number {
  if (currency === 'GRAMS') return balances.gramBalance
  if (currency === 'CRYPTO') return balances.cryptoBalance
  return balances.balance
}

export function balanceUpdate(currency: GameCurrency, amount: number) {
  if (currency === 'GRAMS') return { gramBalance: amount }
  if (currency === 'CRYPTO') return { cryptoBalance: amount }
  return { balance: amount }
}

export function currencyLabel(currency: GameCurrency): string {
  if (currency === 'GRAMS') return 'Gram'
  if (currency === 'CRYPTO') return 'USD'
  return '⭐'
}
