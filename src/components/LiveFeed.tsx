import { useEffect, useState } from 'react'
import type { DropEvent } from '../api/types'
import { getDropsFeed } from '../api/client'
import { prizeImage } from '../utils/assets'

/** Период обновления ленты (3 сек). */
const POLL_MS = 3000
const MAX_DROPS = 3

/**
 * Публичная лента NFT-дропов (строго до 3 последних записей).
 */
export default function LiveFeed() {
  const [drops, setDrops] = useState<DropEvent[]>([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const next = await getDropsFeed(10)
        if (cancelled) {
          return
        }
        setDrops(next.slice(0, MAX_DROPS))
      } catch {
        // Оставляем прежние данные при сетевой ошибке
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  if (drops.length === 0) {
    return null
  }

  return (
    <aside className="glass-card overflow-hidden px-3 py-2" aria-label="Лента дропов">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
        Live drops
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {drops.map((drop) => (
          <li key={drop.id} className="flex items-center gap-2 text-[11px] text-gray-300">
            <img
              src={prizeImage(drop.itemName, drop.itemEmoji)}
              alt=""
              className="h-5 w-5 rounded object-cover"
            />
            <span className="min-w-0 truncate">
              {drop.username ?? 'Игрок'} выиграл {drop.itemName} — {drop.itemPrice}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
