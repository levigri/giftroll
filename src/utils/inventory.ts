// DEPRECATED: заменено серверным API. Файл оставлен для истории, не используется.
import type { Prize } from '../data/cases'

/**
 * Инвентарь выпавших NFT — пока просто массив объектов в localStorage.
 */

const INVENTORY_KEY = 'inventory'

export function getInventory(): Prize[] {
  const raw = localStorage.getItem(INVENTORY_KEY)
  if (raw === null || raw.trim() === '') {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Prize[]) : []
  } catch {
    // Повреждённое значение — чиним, записывая пустой массив.
    localStorage.setItem(INVENTORY_KEY, '[]')
    return []
  }
}

/** Кладёт приз в инвентарь и возвращает обновлённый список. */
export function addToInventory(prize: Prize): Prize[] {
  const next = [...getInventory(), prize]
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(next))
  return next
}
