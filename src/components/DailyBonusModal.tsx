import { useEffect, useMemo, useRef, useState } from 'react'
import { Gift, Star } from 'lucide-react'
import type { DailyBonusPrize } from '../api/types'
import { tapFeedback } from '../telegram'
import { prizeImage } from '../utils/assets'
import AssetImage from './AssetImage'

export interface DailyBonusModalProps {
  winningPrize: DailyBonusPrize
  onClose: () => void
}

const STRIP_LENGTH = 30
const WIN_INDEX = 24
const CELL_W = 88
const CELL_GAP = 12
const CELL_STEP = CELL_W + CELL_GAP
const SPIN_DURATION_MS = 3000

export const dailyBonusPool: DailyBonusPrize[] = [
  { id: 'db-1', label: '1', emoji: '⭐', amount: 1, type: 'BALANCE' },
  { id: 'db-5', label: '5', emoji: '⭐', amount: 5, type: 'BALANCE' },
  { id: 'db-25', label: '25', emoji: '⭐', amount: 25, type: 'BALANCE' },
  { id: 'db-50', label: '50', emoji: '⭐', amount: 50, type: 'BALANCE' },
  { id: 'db-nft', label: 'NFT', emoji: '🍦', amount: 0, type: 'NFT' },
]

function buildStrip(winningPrize: DailyBonusPrize): DailyBonusPrize[] {
  return Array.from({ length: STRIP_LENGTH }, (_, index) => {
    if (index === WIN_INDEX) {
      return winningPrize
    }
    return dailyBonusPool[Math.floor(Math.random() * dailyBonusPool.length)] ?? winningPrize
  })
}

export default function DailyBonusModal({
  winningPrize,
  onClose,
}: DailyBonusModalProps) {
  const strip = useMemo(() => buildStrip(winningPrize), [winningPrize])
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
    ? `+${winningPrize.amount}`
    : `Выпал NFT: ${winningPrize.label}`


  return (
    <div className="roulette" role="dialog" aria-modal="true" aria-label="Ежедневный бонус">
      <div className="roulette__backdrop" onClick={onClose} />

      <div className="roulette__panel">
        <h2 className="roulette__title inline-flex items-center justify-center gap-2">
          <Gift size={18} className="text-[#FFD700]" />
          Ежедневный бонус
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
                  className={`roulette__cell roulette__cell--bonus ${
                    showResult && index === WIN_INDEX ? 'roulette__cell--win' : ''
                  }`}
                >
                  <AssetImage
                    src={prizeImage(prize.label, prize.emoji)}
                    alt={prize.label}
                    className="h-14 w-14"
                  />
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
