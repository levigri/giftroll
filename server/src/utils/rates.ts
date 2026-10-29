/**
 * Курсы пополнений.
 *
 * Базовая цена фиксирована: 100 ⭐ = $1.40.
 * Курс Gram (TON) к USD тянется онлайн с CoinGecko, с кэшем и fallback.
 */

/** Сколько звёзд стоит $1 (базовый курс). */
export const STARS_PER_USD = 100
/** Базовая цена 100 звёзд в долларах. */
export const STARS_BASE_PRICE_USD = 1.4

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd'
/** Резервный курс TON, если CoinGecko недоступен. */
export const FALLBACK_TON_USD = 1.35
/** Кэш курса: 60 секунд, чтобы не упираться в лимиты CoinGecko. */
const RATE_CACHE_TTL_MS = 60_000

let rateCache: { rate: number; fetchedAt: number } | null = null

/**
 * Текущий курс TON в USD. Запрос к CoinGecko с таймаутом 5 секунд,
 * ответ кэшируется на минуту. При ошибке — последний удачный курс,
 * а на холодном старте — FALLBACK_TON_USD.
 */
export async function getGramRate(): Promise<number> {
  const now = Date.now()
  if (rateCache && now - rateCache.fetchedAt < RATE_CACHE_TTL_MS) {
    return rateCache.rate
  }

  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      throw new Error(`CoinGecko HTTP ${res.status}`)
    }

    const data = (await res.json()) as { 'the-open-network'?: { usd?: number } }
    const rate = data?.['the-open-network']?.usd
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('CoinGecko вернул пустой курс')
    }

    rateCache = { rate, fetchedAt: Date.now() }
    return rate
  } catch {
    if (rateCache) {
      return rateCache.rate
    }
    return FALLBACK_TON_USD
  }
}

/**
 * Базовая стоимость звёзд в USD без наценок: 100 ⭐ = $1.40.
 * `getStarsBasePriceUsd(50)` → 0.7
 */
export function getStarsBasePriceUsd(starsAmount: number): number {
  return (starsAmount / STARS_PER_USD) * STARS_BASE_PRICE_USD
}
