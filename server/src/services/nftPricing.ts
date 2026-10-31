import { nftCatalog } from '../data/nftCatalog.js'

function normalizeGiftName(name: string): string {
  return name.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

/** Exact collection-name match. Unknown gifts stay withdrawable but cannot be sold for 0 ⭐. */
export function findNftCatalogEntry(name: string) {
  const normalized = normalizeGiftName(name)
  return nftCatalog.find((prize) => normalizeGiftName(prize.name) === normalized)
}

