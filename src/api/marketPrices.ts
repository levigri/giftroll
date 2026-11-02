import { useSyncExternalStore } from 'react'
import { getCases } from './client'

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

type PriceStreamMessage = PriceUpdateMessage | PriceSnapshotMessage
type Listener = () => void

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
const FALLBACK_POLL_MS = 30_000
const RECONNECT_MS = 5_000

let prices: Record<string, number> = {}
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePriceMessage(raw: string): PriceStreamMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null

    if (parsed.type === 'snapshot' && isRecord(parsed.prices)) {
      const nextPrices: Record<string, number> = {}
      for (const [name, price] of Object.entries(parsed.prices)) {
        if (typeof price === 'number' && Number.isFinite(price) && price >= 0) nextPrices[name] = price
      }
      return { type: 'snapshot', prices: nextPrices }
    }

    if (
      parsed.type === 'price_update' &&
      typeof parsed.giftName === 'string' &&
      typeof parsed.oldPrice === 'number' &&
      typeof parsed.newPrice === 'number' &&
      typeof parsed.source === 'string'
    ) {
      return {
        type: 'price_update',
        giftName: parsed.giftName,
        oldPrice: parsed.oldPrice,
        newPrice: parsed.newPrice,
        source: parsed.source,
      }
    }
  } catch {
    return null
  }
  return null
}

function setSnapshot(nextPrices: Record<string, number>): void {
  const merged = { ...prices }
  for (const [name, price] of Object.entries(nextPrices)) {
    if (price > 0 || !(merged[name] && merged[name] > 0)) merged[name] = price
  }
  prices = merged
  notify()
}

function applyFallbackSnapshot(nextPrices: Record<string, number>): void {
  prices = { ...prices, ...nextPrices }
  notify()
}

async function pollFallbackPrices(): Promise<void> {
  try {
    const response = await getCases()
    const nextPrices: Record<string, number> = {}
    for (const prize of response.nftCatalog ?? []) {
      if (Number.isFinite(prize.price) && prize.price >= 0) nextPrices[prize.name] = prize.price
    }
    applyFallbackSnapshot(nextPrices)
  } catch (error) {
    console.warn('[GiftRoll] Market price fallback request failed:', error)
  }
}

export function subscribeMarketPrices(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getMarketPricesSnapshot(): Record<string, number> {
  return prices
}

export function useMarketPrices(): Record<string, number> {
  return useSyncExternalStore(subscribeMarketPrices, getMarketPricesSnapshot, getMarketPricesSnapshot)
}

export function marketPriceFor(
  giftName: string,
  fallbackPrice: number,
  currentPrices: Record<string, number>,
): number {
  const currentPrice = currentPrices[giftName]
  if (Object.prototype.hasOwnProperty.call(currentPrices, giftName) && typeof currentPrice === 'number') {
    return Math.max(0, currentPrice)
  }
  return fallbackPrice
}

/** Opens the live price stream and polls the existing API while the socket is down. */
export function connectMarketPriceStream(): () => void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => undefined

  let stopped = false
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  let fallbackTimer: number | null = null

  const startFallback = (): void => {
    if (fallbackTimer !== null || stopped) return
    void pollFallbackPrices()
    fallbackTimer = window.setInterval(() => void pollFallbackPrices(), FALLBACK_POLL_MS)
  }

  const clearFallback = (): void => {
    if (fallbackTimer === null) return
    window.clearInterval(fallbackTimer)
    fallbackTimer = null
  }

  const connect = (): void => {
    if (stopped) return
    try {
      const baseUrl = API_BASE || window.location.origin
      const streamUrl = new URL('/api/prices/stream', baseUrl)
      streamUrl.protocol = streamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(streamUrl)

      socket.onopen = () => clearFallback()
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = parsePriceMessage(event.data)
        if (!message) return
        if (message.type === 'snapshot') {
          setSnapshot(message.prices)
          return
        }
        prices = { ...prices, [message.giftName]: message.newPrice }
        notify()
      }
      socket.onclose = () => {
        socket = null
        if (stopped) return
        startFallback()
        reconnectTimer = window.setTimeout(connect, RECONNECT_MS)
      }
      socket.onerror = () => socket?.close()
    } catch (error) {
      console.warn('[GiftRoll] Could not connect to market price stream:', error)
      startFallback()
      reconnectTimer = window.setTimeout(connect, RECONNECT_MS)
    }
  }

  void pollFallbackPrices()
  connect()
  return () => {
    stopped = true
    clearFallback()
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    socket?.close()
    socket = null
  }
}

