import type { Prize } from '../api/types'

/**
 * Картинки предметов GiftRoll.
 * NFT берутся из официального CDN Telegram Gifts (api.changes.tg),
 * звёзды — 3D-иконка Icons8, остальное — подарочная заглушка.
 */

const NFT_IMG = 'https://api.changes.tg/original'

export const STAR_ICON = 'https://img.icons8.com/3d-fluency/512/star.png'

/**
 * Фолбэк для неизвестных призов и битых ссылок CDN.
 * Красивый 3D-подарок на прозрачном фоне.
 */
export const FALLBACK_PRIZE_IMAGE = 'https://img.icons8.com/3d-fluency/512/gift.png'

/**
 * Slug для api.changes.tg: имя без пробелов, апострофов и пунктуации.
 * "Khabib's Papakha" → "KhabibsPapakha", "B-Day Candle" → "BDayCandle".
 */
export function nftSlug(name: string): string {
  return name
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
}

/**
 * Картинка приза: NFT → CDN Telegram, звёздный баланс → 3D-звезда,
 * всё остальное → единый фолбэк.
 */
export function prizeImage(
  name: string,
  emoji?: string | null,
  type?: 'BALANCE' | 'NFT',
): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) {
    return FALLBACK_PRIZE_IMAGE
  }

  if (type === 'BALANCE' || trimmed.startsWith('+') || emoji === '⭐') {
    return STAR_ICON
  }

  if (trimmed.toUpperCase() === 'NFT') {
    return `${NFT_IMG}/IceCream.png?size=256`
  }

  const slug = nftSlug(trimmed)
  if (!slug) {
    return FALLBACK_PRIZE_IMAGE
  }

  return `${NFT_IMG}/${slug}.png?size=256`
}

/**
 * Находит самый дорогой предмет из призов кейса.
 */
export function getBestPrize(prizes?: Prize[]): Prize | undefined {
  if (!prizes || prizes.length === 0) {
    return undefined
  }
  return prizes.reduce(
    (best, curr) => (curr.price > (best?.price ?? 0) ? curr : best),
    prizes[0],
  )
}
