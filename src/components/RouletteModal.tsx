import { useEffect, useRef, useState } from 'react'
import { Star, X } from 'lucide-react'
import type { CaseItem, Prize } from '../api/types'
import { OPEN_COUNTS, type OpenCount } from '../pages/CasesPage'
import { errorFeedback, tapFeedback } from '../telegram'
import { prizeImage } from '../utils/assets'
import AssetImage from './AssetImage'

export interface RouletteModalProps {
  caseItem: CaseItem
  /** Текущий баланс — для блокировки кнопки, если звёзд не хватает. */
  balance: number
  onClose: () => void
  /** Открывает count кейсов и возвращает выпавшие призы в том же порядке. */
  onOpen: (count: OpenCount) => Promise<Prize[]>
}

/** Длина ленты: приз-победитель стоит на WINNER_INDEX. */
const STRIP_LENGTH = 30
const WINNER_INDEX = 24
const SPIN_DURATION_MS = 3000

/** Размер ячейки и зазор под каждое количество рулеток. */
const CELL_SIZES: Record<OpenCount, number> = { 1: 88, 2: 72, 5: 52 }
const CELL_GAPS: Record<OpenCount, number> = { 1: 12, 2: 10, 5: 8 }

type Phase = 'idle' | 'spinning' | 'result'

function randomPrize(pool: Prize[]): Prize | null {
  if (pool.length === 0) {
    return null
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

/**
 * Лента призов. Если передан winner, он встаёт ровно на WINNER_INDEX —
 * именно его и покажет указатель после остановки.
 */
function buildStrip(pool: Prize[], winner?: Prize): Prize[] {
  const fallback = winner ?? pool[0]
  if (!fallback) {
    return []
  }

  return Array.from({ length: STRIP_LENGTH }, (_, index) => {
    if (winner && index === WINNER_INDEX) {
      return winner
    }
    return randomPrize(pool) ?? fallback
  })
}

/**
 * Модалка кейса: сверху одна или несколько лент, которые крутятся
 * одновременно, снизу — список всех возможных дропов с шансами.
 */
export default function RouletteModal({
  caseItem,
  balance,
  onClose,
  onOpen,
}: RouletteModalProps) {
  const pool = caseItem.prizes

  const [count, setCount] = useState<OpenCount>(1)
  const [phase, setPhase] = useState<Phase>('idle')
  const [results, setResults] = useState<Prize[]>([])
  const [strips, setStrips] = useState<Prize[][]>(() => [buildStrip(pool)])
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)

  const cellSize = CELL_SIZES[count]
  const cellGap = CELL_GAPS[count]
  const totalPrice = caseItem.price * count
  const notEnough = balance < totalPrice
  const spinning = phase === 'spinning'

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    [],
  )

  /** Сброс в начальное состояние: ленты на месте, итогов нет. */
  const resetTo = (nextCount: OpenCount) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setPhase('idle')
    setResults([])
    setOffset(0)
    setError(null)
    setStrips(Array.from({ length: nextCount }, () => buildStrip(pool)))
  }

  const handleCount = (next: OpenCount) => {
    if (spinning || next === count) {
      return
    }
    tapFeedback('light')
    setCount(next)
    // Сразу показываем столько лент, сколько выбрал игрок, в том числе после результата.
    resetTo(next)
  }

  const handleOpen = async () => {
    if (spinning) {
      return
    }

    if (notEnough) {
      errorFeedback()
      setError('Недостаточно звёзд на балансе')
      return
    }

    setError(null)
    setResults([])
    setOffset(0)
    setPhase('spinning')
    tapFeedback('medium')

    try {
      const prizes = await onOpen(count)
      if (prizes.length === 0) {
        setPhase('idle')
        return
      }

      setStrips(prizes.map((prize) => buildStrip(pool, prize)))
      setResults(prizes)

      // Считаем сдвиг от тех же размеров ячеек и промежутков, что заданы ниже.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const viewport = viewportRef.current
          if (!viewport) {
            return
          }

          const viewportWidth = viewport.clientWidth
          const targetOffset =
            viewportWidth / 2 -
            (WINNER_INDEX * (cellSize + cellGap) + cellSize / 2)
          const randomOffset = (Math.random() * 0.8 - 0.4) * cellSize
          setOffset(targetOffset + randomOffset)
        })
      })

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setPhase('result')
        tapFeedback('medium')
      }, SPIN_DURATION_MS)
    } catch (err: unknown) {
      errorFeedback()
      setPhase('idle')
      setError(err instanceof Error ? err.message : 'Не удалось открыть кейс')
    }
  }

  const balanceFont = count === 5 ? 'text-[9px]' : 'text-[11px]'

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Кейс ${caseItem.name}`}
    >
      <button type="button" className="absolute inset-0" aria-label="Закрыть" onClick={onClose} />

      <div className="relative flex max-h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0B0C10] shadow-[0_-20px_80px_rgba(138,43,226,0.25)]">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            {/* Иконка кейса берётся из самого объекта caseItem: картинка, если есть, иначе эмодзи. */}
            {caseItem.imageUrl ? (
              <img
                src={caseItem.imageUrl}
                alt={caseItem.name}
                referrerPolicy="no-referrer"
                className="h-12 w-12 shrink-0 object-contain"
              />
            ) : (
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl leading-none"
                aria-hidden="true"
              >
                {caseItem.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Кейс</p>
              <h2 className="truncate text-xl font-extrabold text-white">{caseItem.name}</h2>
              <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-gray-300">
                {caseItem.price} ⭐ за штуку
                {count > 1 && <span className="text-gray-500">· {count} шт = {totalPrice} ⭐</span>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition hover:text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-2">
          <div
            className="flex shrink-0 flex-col gap-2"
            style={{ minHeight: count * (cellSize + 12) + (count - 1) * 8 }}
          >
            {strips.map((strip, stripIndex) => (
              <div
                key={stripIndex}
                ref={stripIndex === 0 ? viewportRef : undefined}
                className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                style={{ height: cellSize + 12 }}
              >
                <div
                  className="absolute left-0 top-[6px] flex"
                  style={{
                    gap: cellGap,
                    transform: `translateX(${offset}px)`,
                    transition:
                      spinning && results.length > 0
                        ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
                        : undefined,
                  }}
                >
                  {strip.map((prize, index) => {
                    const isWin = phase === 'result' && index === WINNER_INDEX
                    return (
                      <div
                        key={`${prize.id}-${index}`}
                        className={`flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border bg-black/40 ${
                          isWin ? 'border-[#FFD700] shadow-gold' : 'border-white/10'
                        }`}
                        style={{ width: cellSize, height: cellSize }}
                      >
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: cellSize * (prize.type === 'BALANCE' ? 0.46 : 0.62),
                            height: cellSize * (prize.type === 'BALANCE' ? 0.46 : 0.62),
                          }}
                        >
                          <AssetImage
                            src={prizeImage(prize.name, prize.emoji, prize.type)}
                            alt={prize.name}
                            className="h-full w-full"
                            glow={
                              prize.type === 'NFT'
                                ? 'rgba(138,43,226,0.5)'
                                : 'rgba(255,215,0,0.45)'
                            }
                          />
                        </div>
                        {prize.type === 'BALANCE' && (
                          <span
                            className={`font-extrabold leading-none text-[#FFD700] ${balanceFont}`}
                          >
                            +{prize.price} ⭐
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-[3px] -translate-x-1/2 bg-gradient-to-b from-[#FFD700] to-[#FFA500] shadow-gold" />
                <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[10px] border-x-transparent border-t-[#FFD700] drop-shadow-[0_0_10px_rgba(255,215,0,0.8)]" />
                <div className="pointer-events-none absolute bottom-0 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[10px] border-x-transparent border-b-[#FFD700]" />
              </div>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
                {error}
              </div>
            )}

            <h3 className="mb-2 mt-4 flex items-center gap-1.5 text-sm font-extrabold text-white">
              <Star size={14} className="text-[#FFD700]" fill="currentColor" />
              Что может выпасть
            </h3>

            <div className="grid grid-cols-3 gap-2">
              {pool.map((prize) => (
                <div
                  key={prize.id}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-2 text-center"
                >
                  <div className="flex h-11 w-11 items-center justify-center">
                    <AssetImage
                      src={prizeImage(prize.name, prize.emoji, prize.type)}
                      alt={prize.name}
                      className="h-full w-full"
                      glow={
                        prize.type === 'NFT' ? 'rgba(138,43,226,0.45)' : 'rgba(255,215,0,0.4)'
                      }
                    />
                  </div>
                  <span
                    className="w-full truncate text-[10px] font-bold leading-tight text-white"
                    title={prize.name}
                  >
                    {prize.type === 'BALANCE' ? `+${prize.price} ⭐` : prize.name}
                  </span>
                  {prize.type === 'NFT' && (
                    <span className="text-[10px] font-extrabold leading-none text-[#FFD700]">
                      {prize.price} ⭐
                    </span>
                  )}
                  <span className="rounded-full border border-white/10 bg-black/35 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-gray-300">
                    {(prize.chance ?? 0).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="border-t border-white/10 bg-[#0B0C10] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
          {(phase === 'idle' || phase === 'result') && (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-1.5" role="group" aria-label="Сколько кейсов открыть">
                {OPEN_COUNTS.map((value) => {
                  const active = value === count
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className={`flex-1 rounded-xl py-2 text-sm font-extrabold transition ${
                        active
                          ? 'border border-[#FFD700] bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-black shadow-[0_2px_12px_rgba(255,215,0,0.35)]'
                          : 'border border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                      }`}
                      onClick={() => handleCount(value)}
                    >
                      ×{value}
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                className="gold-btn flex w-full items-center justify-center gap-1.5 py-3.5 text-base"
                onClick={() => void handleOpen()}
                disabled={notEnough}
              >
                {notEnough ? (
                  'Недостаточно звёзд'
                ) : (
                  <>
                    {phase === 'result' ? 'Открыть ещё за ' : 'Открыть за '}{totalPrice}
                    <Star size={15} fill="currentColor" />
                  </>
                )}
              </button>
            </div>
          )}

          {phase === 'spinning' && (
            <button
              type="button"
              className="gold-btn w-full py-3.5 text-base"
              disabled
            >
              Крутим…
            </button>
          )}

          {phase === 'result' && (
            <button
              type="button"
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 font-bold text-gray-300 transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              Забрать и закрыть
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
