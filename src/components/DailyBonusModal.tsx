import { useEffect, useMemo, useRef, useState } from 'react'
import { Gift, KeyRound, Star } from 'lucide-react'
import type { DailyBonusPrize } from '../api/types'
import { DEPOSIT_BONUS_CASE } from '../data/cases'
import { tapFeedback } from '../telegram'
import { prizeImage } from '../utils/assets'
import AssetImage from './AssetImage'

export interface DailyBonusModalProps {
  winningPrize: DailyBonusPrize
  onClose: () => void
  /** Откуда пришли: ежедневный бесплатный кейс или бонусный кейс за депозит. */
  source?: 'daily' | 'deposit' | 'promo'
}

const STRIP_LENGTH = 30
const WIN_INDEX = 24
const CELL_W = 88
const CELL_GAP = 12
const CELL_STEP = CELL_W + CELL_GAP
const SPIN_DURATION_MS = 3000

/** Пул приза + шанс из серверных данных (`server/src/data/dailyBonus.ts`). */
export type PoolEntry = DailyBonusPrize & { chance: number }

/** Призы ежедневного бесплатного кейса — зеркало `dailyBonusPrizes` на сервере. */
const DAILY_POOL: PoolEntry[] = [
  { id: 'db-1', label: '1', emoji: '⭐', amount: 1, type: 'BALANCE', chance: 45 },
  { id: 'db-5', label: '5', emoji: '⭐', amount: 5, type: 'BALANCE', chance: 30 },
  { id: 'db-10', label: '10', emoji: '⭐', amount: 10, type: 'BALANCE', chance: 15 },
  { id: 'db-25', label: '25', emoji: '⭐', amount: 25, type: 'BALANCE', chance: 8 },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, type: 'BALANCE', chance: 2 },
  { id: 'db-nft', label: 'NFT', emoji: '🍦', amount: 0, type: 'NFT', chance: 0 },
]

/** Призы бонусного кейса за депозит — зеркало `depositBonusCase` на сервере. */
const DEPOSIT_POOL: PoolEntry[] = [
  { id: 'db-10', label: '10', emoji: '⭐', amount: 10, type: 'BALANCE', chance: 55 },
  { id: 'db-20', label: '20', emoji: '⭐', amount: 20, type: 'BALANCE', chance: 30 },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, type: 'BALANCE', chance: 14.8 },
  { id: 'ice-cream', label: 'Ice Cream', emoji: '🍦', amount: 0, type: 'NFT', chance: 0.1 },
  { id: 'clover-pin', label: 'Clover Pin', emoji: '🍀', amount: 0, type: 'NFT', chance: 0.1 },
  { id: 'sakura-flower', label: 'Sakura Flower', emoji: '🌸', amount: 0, type: 'NFT', chance: 0 },
]

/** Призы промокод-кейса — зеркало `server/src/data/promoCase.ts`. */
const PROMO_POOL: PoolEntry[] = [
  { id: 'p-1', label: '1', emoji: '⭐', amount: 1, type: 'BALANCE', chance: 55 },
  { id: 'p-5', label: '5', emoji: '⭐', amount: 5, type: 'BALANCE', chance: 25 },
  { id: 'p-10', label: '10', emoji: '⭐', amount: 10, type: 'BALANCE', chance: 12 },
  { id: 'p-20', label: '20', emoji: '⭐', amount: 20, type: 'BALANCE', chance: 6 },
  { id: 'p-50', label: '50', emoji: '⭐', amount: 50, type: 'BALANCE', chance: 1.9 },
  { id: 'p-ice', label: 'Ice Cream', emoji: '🍦', amount: 0, type: 'NFT', chance: 0.1 },
  { id: 'p-clover', label: 'Clover Pin', emoji: '🍀', amount: 0, type: 'NFT', chance: 0 },
  { id: 'p-sakura', label: 'Sakura Flower', emoji: '🌸', amount: 0, type: 'NFT', chance: 0 },
]

export const dailyBonusPool: DailyBonusPrize[] = DAILY_POOL

function buildStrip(pool: PoolEntry[], winningPrize: DailyBonusPrize): DailyBonusPrize[] {
  return Array.from({ length: STRIP_LENGTH }, (_, index) => {
    if (index === WIN_INDEX) {
      return winningPrize
    }
    return pool[Math.floor(Math.random() * pool.length)] ?? winningPrize
  })
}

/** Формат шанса: целые — без хвоста, дробные — с точностью до сотых. */
function formatChance(chance: number): string {
  return `${chance % 1 === 0 ? chance.toFixed(0) : chance.toFixed(2)}%`
}

export default function DailyBonusModal({
  winningPrize,
  onClose,
  source = 'daily',
}: DailyBonusModalProps) {
  const isDeposit = source === 'deposit'
  const isPromo = source === 'promo'
  const pool = isDeposit ? DEPOSIT_POOL : isPromo ? PROMO_POOL : DAILY_POOL
  const strip = useMemo(() => buildStrip(pool, winningPrize), [pool, winningPrize])
  const viewportRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const target = viewport.clientWidth / 2 - (WIN_INDEX * CELL_STEP + CELL_W / 2)
    const frame = requestAnimationFrame(() => setOffset(target))
    const timer = setTimeout(() => {
      tapFeedback('medium')
      setShowResult(true)
    }, SPIN_DURATION_MS)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  const isBalance = winningPrize.type === 'BALANCE'
  const resultText = isBalance
    ? `+${winningPrize.amount} ⭐`
    : `Выпал NFT: ${winningPrize.label}`


  return (
    <div
      className="roulette"
      role="dialog"
      aria-modal="true"
      aria-label={isDeposit ? DEPOSIT_BONUS_CASE.name : isPromo ? 'Промокод-кейс' : 'Ежедневный бонус'}
    >
      <div className="roulette__backdrop" onClick={onClose} />

      <div className="roulette__panel">
        <h2 className="roulette__title inline-flex items-center justify-center gap-2">
          {isDeposit ? (
            <span className="text-lg leading-none" aria-hidden="true">
              {DEPOSIT_BONUS_CASE.emoji}
            </span>
          ) : isPromo ? (
            <KeyRound size={18} className="text-violet-300" />
          ) : (
            <Gift size={18} className="text-[#FFD700]" />
          )}
          {isDeposit ? DEPOSIT_BONUS_CASE.name : isPromo ? 'Промокод-кейс' : 'Ежедневный бонус'}
        </h2>

        <div className="roulette__stage">
          <div className="roulette__viewport" ref={viewportRef}>
            <div
              className="roulette__strip"
              style={{ transform: `translateX(${offset}px)` }}
            >
              {strip.map((prize, index) => (
                <div
                  key={`${prize.id}-${index}`}
                  className={`roulette__cell roulette__cell--bonus flex-col gap-0.5 ${
                    showResult && index === WIN_INDEX ? 'roulette__cell--win' : ''
                  }`}
                >
                  <AssetImage
                    src={prizeImage(prize.label, prize.emoji)}
                    alt={prize.label}
                    className="h-12 w-12"
                  />
                  {/* Сумма звёзд всегда подписана прямо в ячейке ленты. */}
                  {prize.type === 'BALANCE' && (
                    <span className="text-[11px] font-extrabold leading-none text-[#FFD700]">
                      +{prize.amount} ⭐
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="roulette__marker" />
          </div>
        </div>

        <div className="roulette__status">
          <span className={`roulette__spinning ${showResult ? 'roulette__spinning--hidden' : ''}`}>
            Крутим...
          </span>
          <span
            className={`roulette__result-text ${
              showResult ? 'roulette__result-text--visible' : ''
            } ${isBalance ? 'roulette__result-text--balance' : 'roulette__result-text--nft'} inline-flex items-center justify-center gap-1`}
          >
            {isBalance && showResult && <Star size={16} fill="currentColor" />}
            {resultText}
          </span>
        </div>

        {/* Что может выпасть: суммы звёзд и шансы призов. */}
        <div className="min-h-0">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-white">
            <Star size={14} className="text-[#FFD700]" fill="currentColor" />
            Что может выпасть
          </h3>
          <div className="grid max-h-[34vh] grid-cols-3 gap-2 overflow-y-auto">
            {pool.map((prize) => (
              <div
                key={prize.id}
                className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-2 text-center"
              >
                <div className="flex h-11 w-11 items-center justify-center">
                  <AssetImage
                    src={prizeImage(prize.label, prize.emoji)}
                    alt={prize.label}
                    className="h-full w-full"
                  />
                </div>
                {prize.type === 'BALANCE' ? (
                  <span className="font-extrabold leading-tight text-[10px] text-[#FFD700]">
                    +{prize.amount} ⭐
                  </span>
                ) : (
                  <span className="w-full truncate text-[10px] font-bold leading-tight text-white">
                    {prize.label}
                  </span>
                )}
                <span className="rounded-full border border-white/10 bg-black/35 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-gray-300">
                  {formatChance(prize.chance)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {showResult && (
          <div className="roulette__actions">
            <button type="button" className="gold-btn w-full py-3.5 text-base" onClick={onClose}>
              {isBalance ? 'Забрать' : 'Забрать в Telegram'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
