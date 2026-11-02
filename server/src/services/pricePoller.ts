import { env } from '../config/env.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { refreshTelegramMarketPrices } from './userbot.js'

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

const POLL_INTERVAL_MS = 30_000
const CHANGE_THRESHOLD = 0.02

const listeners = new Set<PriceListener>()
const latestMarketPrices = new Map<string, number>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInProgress = false

function normalizeGiftName(name: string): string {
  return name.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

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

async function pollPrices(): Promise<void> {
  if (pollInProgress) return
  pollInProgress = true
  try {
    const telegramPrices = await refreshTelegramMarketPrices()
    if (!telegramPrices) return

    for (const prize of nftCatalog) {
      const newPrice = telegramPrices.get(normalizeGiftName(prize.name))
      if (!newPrice || newPrice <= 0) continue

      latestMarketPrices.set(prize.name, newPrice)
      const oldPrice = prize.price
      const difference = oldPrice > 0 ? Math.abs(newPrice - oldPrice) / oldPrice : 1
      if (difference <= CHANGE_THRESHOLD) continue
      prize.price = newPrice

      const source = 'Telegram official resale floor'
      console.log(`[PricePoller] ${prize.name}: ${oldPrice} -> ${newPrice} (${source})`)
      publish({ type: 'price_update', giftName: prize.name, oldPrice, newPrice, source })
    }
  } catch (error) {
    console.warn('[PricePoller] Telegram floor refresh failed; catalog prices remain available:', error)
  } finally {
    pollInProgress = false
  }
}

/** Refreshes official Telegram floors every 30 seconds in production only. */
export function startPricePoller(): void {
  if (env.NODE_ENV !== 'production' || pollTimer) return
  void pollPrices()
  pollTimer = setInterval(() => void pollPrices(), POLL_INTERVAL_MS)
  pollTimer.unref()
  console.info('[PricePoller] Started (Telegram floors, 30s interval)')
}

export function stopPricePoller(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
