import { env } from '../config/env.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { getGramRate, getStarsBasePriceUsd } from '../utils/rates.js'
import { fetchGiftAssetPrice, updateNftCatalogPrice } from './giftAssetPricing.js'
import { getTelegramMarketPrice } from './userbot.js'

export interface PriceUpdateMessage {
  type: 'price_update'
  giftName: string
  oldPrice: number
  newPrice: number
  source: string
}

export interface PriceSnapshotMessage {
  type: 'snapshot'
  prices: Record<string, number>
}

export type PriceStreamMessage = PriceUpdateMessage | PriceSnapshotMessage
type PriceListener = (message: PriceStreamMessage) => void

const POLL_INTERVAL_MS = 10_000
const CHANGE_THRESHOLD = 0.02
const MAX_CONCURRENT_REQUESTS = 8

const listeners = new Set<PriceListener>()
const latestMarketPrices = new Map<string, number>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInProgress = false

export function getPriceSnapshot(): PriceSnapshotMessage {
  const prices: Record<string, number> = {}
  for (const prize of nftCatalog) prices[prize.name] = latestMarketPrices.get(prize.name) ?? 0
  return { type: 'snapshot', prices }
}

export function subscribePriceUpdates(listener: PriceListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(message: PriceStreamMessage): void {
  for (const listener of listeners) {
    try {
      listener(message)
    } catch (error) {
      console.error('[PricePoller] Failed to publish price update:', error)
    }
  }
}

function convertTonToStars(tonAmount: number, tonUsd: number): number | null {
  const price = Math.round((tonAmount * tonUsd * 100) / getStarsBasePriceUsd(100))
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

async function getPriceInStars(
  giftName: string,
  getTonUsdRate: () => Promise<number>,
): Promise<{ price: number; source: string } | null> {
  const quote = await fetchGiftAssetPrice(giftName)
  if (quote) {
    const rate = await getTonUsdRate()
    const price = convertTonToStars(quote.floor, rate)
    return price === null ? null : { price, source: quote.source }
  }

  const fallbackPrice = await getTelegramMarketPrice(giftName)
  return fallbackPrice && fallbackPrice > 0
    ? { price: fallbackPrice, source: 'Telegram Marketplace fallback' }
    : null
}

async function pollPrices(): Promise<void> {
  if (pollInProgress) return
  pollInProgress = true
  try {
    let nextIndex = 0
    let tonUsdRatePromise: Promise<number> | null = null
    const getTonUsdRate = (): Promise<number> => {
      tonUsdRatePromise ??= getGramRate()
      return tonUsdRatePromise
    }
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_REQUESTS, nftCatalog.length) },
      async () => {
        while (nextIndex < nftCatalog.length) {
          const prize = nftCatalog[nextIndex++]
          if (!prize) continue

          try {
            const quote = await getPriceInStars(prize.name, getTonUsdRate)
            if (!quote) continue
            latestMarketPrices.set(prize.name, quote.price)

            const oldPrice = prize.price
            const difference = oldPrice > 0 ? Math.abs(quote.price - oldPrice) / oldPrice : 1
            if (difference <= CHANGE_THRESHOLD) continue
            if (!updateNftCatalogPrice(prize.name, quote.price)) continue

            console.log(`[PricePoller] ${prize.name}: ${oldPrice} -> ${quote.price} (${quote.source})`)
            publish({
              type: 'price_update',
              giftName: prize.name,
              oldPrice,
              newPrice: quote.price,
              source: quote.source,
            })
          } catch (error) {
            console.warn(`[PricePoller] Failed to update ${prize.name}:`, error)
          }
        }
      },
    )
    await Promise.all(workers)
  } finally {
    pollInProgress = false
  }
}

/** Starts only in production. Prices are refreshed immediately and every ten seconds. */
export function startPricePoller(): void {
  if (env.NODE_ENV !== 'production' || pollTimer) return
  void pollPrices()
  pollTimer = setInterval(() => void pollPrices(), POLL_INTERVAL_MS)
  pollTimer.unref()
  console.info('[PricePoller] Started (10s interval)')
}

export function stopPricePoller(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
