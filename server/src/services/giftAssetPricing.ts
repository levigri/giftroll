import { nftCatalog } from '../data/nftCatalog.js'
import { getGramRate, getStarsBasePriceUsd } from '../utils/rates.js'
import { getTelegramMarketPrice } from './userbot.js'

const GIFT_ASSET_API = 'https://api.giftasset.pro/api/v1/gifts/get_gift_by_name'
const CACHE_TTL_MS = 10_000

export interface GiftAssetPrice {
  /** Aggregate floor from GiftAsset, denominated in TON. */
  floor: number
  /** Aggregate average from GiftAsset, denominated in TON. */
  avg: number
  source: string
}

interface CachedPrice {
  expiresAt: number
  value: GiftAssetPrice | null
}

const priceCache = new Map<string, CachedPrice>()
const inflight = new Map<string, Promise<GiftAssetPrice | null>>()
let lastFailureLogAt = 0
let tonUsdRequest: Promise<number> | null = null

function normalizeName(name: string): string {
  return name.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function getTonUsdRate(): Promise<number> {
  if (tonUsdRequest) return tonUsdRequest
  const request = getGramRate()
  tonUsdRequest = request
  void request.finally(() => {
    if (tonUsdRequest === request) tonUsdRequest = null
  })
  return request
}

/** Fetches aggregate GiftAsset floor and average (TON), cached for ten seconds. */
export async function fetchGiftAssetPrice(giftName: string): Promise<GiftAssetPrice | null> {
  const normalized = normalizeName(giftName)
  if (!normalized) return null

  const cached = priceCache.get(normalized)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const pending = inflight.get(normalized)
  if (pending) return pending

  const request = (async (): Promise<GiftAssetPrice | null> => {
    let result: GiftAssetPrice | null = null
    try {
      const url = new URL(GIFT_ASSET_API)
      url.searchParams.set('name', giftName.trim())
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) throw new Error(`GiftAsset HTTP ${response.status}`)

      const body: unknown = await response.json()
      if (!isRecord(body) || !isRecord(body.market_floor)) {
        throw new Error('GiftAsset response has no market_floor')
      }

      const floor = readNumber(body.market_floor.min)
      const average = readNumber(body.market_floor.avg)
      if (floor !== null) {
        const providers = isRecord(body.providers) ? Object.keys(body.providers) : []
        result = {
          floor,
          avg: average ?? floor,
          source: providers.length > 0 ? `GiftAsset (${providers.join(', ')})` : 'GiftAsset',
        }
      }
    } catch (error) {
      if (Date.now() - lastFailureLogAt >= 60_000) {
        lastFailureLogAt = Date.now()
        console.warn(`[GiftAsset] Price requests are failing; Telegram pricing fallback will be used:`, error)
      }
    }

    priceCache.set(normalized, { value: result, expiresAt: Date.now() + CACHE_TTL_MS })
    return result
  })()

  inflight.set(normalized, request)
  try {
    return await request
  } finally {
    if (inflight.get(normalized) === request) inflight.delete(normalized)
  }
}

/** Converts GiftAsset's TON floor into GiftRoll Stars using the live TON/USD rate. */
export async function getGiftAssetFloorInStars(giftName: string): Promise<number | null> {
  const quote = await fetchGiftAssetPrice(giftName)
  if (!quote) return null
  const tonUsd = await getTonUsdRate()
  const stars = quote.floor * tonUsd / getStarsBasePriceUsd(100) * 100
  return Number.isFinite(stars) && stars > 0 ? Math.round(stars) : null
}

/** GiftAsset is primary; Telegram's own Stars resale price is the fallback. */
export async function getCurrentNftPriceInStars(giftName: string): Promise<number | null> {
  const giftAssetPrice = await getGiftAssetFloorInStars(giftName)
  if (giftAssetPrice !== null) return giftAssetPrice

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getTelegramMarketPrice(giftName),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** Updates the matching in-memory catalog item after a verified live quote. */
export function updateNftCatalogPrice(giftName: string, price: number): boolean {
  const normalized = normalizeName(giftName)
  const prize = nftCatalog.find((item) => normalizeName(item.name) === normalized)
  if (!prize || !Number.isSafeInteger(price) || price <= 0) return false
  prize.price = price
  return true
}
