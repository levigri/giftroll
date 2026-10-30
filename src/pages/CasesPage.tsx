import { useEffect, useState } from 'react'
import { Gift, Star, Wallet } from 'lucide-react'
import type { CaseItem } from '../api/types'
import { tapFeedback } from '../telegram'
import { FALLBACK_PRIZE_IMAGE, getBestPrize, prizeImage } from '../utils/assets'
import type { BonusState } from './GamesPage'

/** Сколько кейсов открывать за один клик. */
export type OpenCount = 1 | 2 | 5

export const OPEN_COUNTS: OpenCount[] = [1, 2, 5]

function formatLeft(ms: number): string {
  if (ms <= 0) {
    return 'уже доступен'
  }
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** Тикающий таймер до времени `target` (для карточки недоступного кейса). */
function useCountdown(target: string | null, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || !target) {
      return
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active, target])

  if (!target) {
    return null
  }
  return formatLeft(Date.parse(target) - now)
}

export interface CasesPageProps {
  cases: CaseItem[]
  loading: boolean
  onOpenCase: (caseItem: CaseItem) => void
  connected: boolean
  walletLabel: string | null
  connectionRestored: boolean
  onConnect: () => void
  /** Бонусные кейсы: ежедневный и за депозит от 200 ⭐. */
  bonus: BonusState
  onOpenFreeCase: () => void
  onClaimDepositBonus: () => void
  /** Переход на вкладку пополнения (для заблокированной карточки бонусного кейса). */
  onGoDeposit: () => void
}

/** Вкладка «Кейсы»: сетка кейсов и подключение TON-кошелька. */
export default function CasesPage({
  cases,
  loading,
  onOpenCase,
  connected,
  walletLabel,
  connectionRestored,
  onConnect,
  bonus,
  onOpenFreeCase,
  onClaimDepositBonus,
  onGoDeposit,
}: CasesPageProps) {
  const hottestPrice = cases.reduce((max, item) => Math.max(max, item.price), 0)
  const countdown = useCountdown(bonus.dailyAvailableAt, !bonus.dailyAvailable)

  return (
    <>
      <button
        type="button"
        className="glass-card flex w-full items-center justify-center gap-2 py-3 text-sm font-bold text-white transition hover:border-[#8A2BE2]/50 hover:bg-white/[0.08]"
        onClick={onConnect}
      >
        <Wallet size={16} className={connected ? 'text-[#FFD700]' : 'text-[#8A2BE2]'} />
        {connected ? `Кошелёк: ${walletLabel ?? ''}` : 'Подключить кошелёк'}
      </button>

      <section className="flex flex-col gap-3">
        {loading && cases.length === 0 ? (
          <div className="py-16 text-center font-bold text-gray-400">Загрузка кейсов...</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* Бесплатный кейс (ежедневный бонус) — живёт в общем списке кейсов. */}
            <article
              role="button"
              tabIndex={bonus.dailyAvailable ? 0 : -1}
              aria-disabled={!bonus.dailyAvailable}
              onClick={() => {
                if (!bonus.dailyAvailable) {
                  return
                }
                tapFeedback('light')
                onOpenFreeCase()
              }}
              onKeyDown={(e) => {
                if (!bonus.dailyAvailable) {
                  return
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  tapFeedback('light')
                  onOpenFreeCase()
                }
              }}
              className={`glass-card group relative flex flex-col items-center gap-2 overflow-hidden p-3.5 text-center transition ${
                bonus.dailyAvailable
                  ? 'cursor-pointer border-[#FFD700]/60 shadow-[0_0_26px_rgba(255,215,0,0.22)] hover:scale-[1.02] active:scale-[0.98]'
                  : 'cursor-not-allowed opacity-55 grayscale'
              }`}
            >
              <span className="absolute right-2 top-2 rounded-full border border-[#FFD700]/40 bg-[#FFD700]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#FFD700]">
                Бесплатно
              </span>

              <div className="relative mt-1 flex h-24 w-24 items-center justify-center rounded-2xl border border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/20 to-[#FFA500]/10">
                <Gift
                  size={42}
                  className={`text-[#FFD700] transition-transform duration-300 ${
                    bonus.dailyAvailable ? 'group-hover:scale-110' : ''
                  }`}
                />
              </div>

              <h3 className="m-0 text-[15px] font-extrabold text-white">Бесплатный кейс</h3>

              <div className="flex items-center gap-1 text-sm font-extrabold text-[#FFD700]">
                {bonus.dailyAvailable ? (
                  <>0 <Star size={13} fill="currentColor" /></>
                ) : (
                  <span className="tabular-nums">{countdown ?? 'Завтра'}</span>
                )}
              </div>

              <div
                className={`mt-1 flex w-full items-center justify-center rounded-xl border py-1.5 text-xs font-bold ${
                  bonus.dailyAvailable
                    ? 'border-[#FFD700]/50 bg-[#FFD700]/10 text-[#FFE9A3] group-hover:text-white'
                    : 'border-white/10 bg-white/5 text-gray-400'
                }`}
              >
                {bonus.dailyAvailable ? 'Подписка + шеринг' : 'Возвращайся позже'}
              </div>
            </article>

            {/* Бонусный кейс за депозит от 200 ⭐ — виден всегда: без награды это "зацепка" (бесплатно, но только за депозит от 200 ⭐), с наградой — кнопка «Забрать». */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => {
                tapFeedback('light')
                if (bonus.freeCases > 0) {
                  onClaimDepositBonus()
                } else {
                  onGoDeposit()
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  tapFeedback('light')
                  if (bonus.freeCases > 0) {
                    onClaimDepositBonus()
                  } else {
                    onGoDeposit()
                  }
                }
              }}
              className={`glass-card group relative flex cursor-pointer flex-col items-center gap-2 overflow-hidden p-3.5 text-center transition hover:scale-[1.02] active:scale-[0.98] ${
                bonus.freeCases > 0
                  ? 'border-emerald-400/50 shadow-[0_0_24px_rgba(52,211,153,0.18)]'
                  : 'border-dashed border-[#FFD700]/35 shadow-[0_0_20px_rgba(255,215,0,0.10)]'
              }`}
            >
              <span
                className={`absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  bonus.freeCases > 0
                    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                    : 'border-[#FFD700]/40 bg-[#FFD700]/15 text-[#FFD700]'
                }`}
              >
                {bonus.freeCases > 0 ? `×${bonus.freeCases}` : '200 ⭐'}
              </span>

              <div
                className={`relative mt-1 flex h-24 w-24 items-center justify-center rounded-2xl border bg-gradient-to-br ${
                  bonus.freeCases > 0
                    ? 'border-emerald-400/40 from-emerald-400/20 to-emerald-600/10'
                    : 'border-[#FFD700]/35 from-[#FFD700]/15 to-[#FFA500]/5'
                }`}
              >
                <Gift
                  size={42}
                  className={`transition-transform duration-300 group-hover:scale-110 ${
                    bonus.freeCases > 0 ? 'text-emerald-300' : 'text-[#FFD700]/75'
                  }`}
                />
              </div>

              <h3 className="m-0 text-[15px] font-extrabold text-white">Бонусный кейс</h3>

              <div
                className={`flex items-center gap-1 text-sm font-extrabold ${
                  bonus.freeCases > 0 ? 'text-emerald-300' : 'text-[#FFD700]'
                }`}
              >
                {bonus.freeCases > 0 ? 'За депозит' : 'Бесплатно'}
              </div>

              <div
                className={`mt-1 flex w-full items-center justify-center rounded-xl border py-1.5 text-xs font-bold transition group-hover:text-white ${
                  bonus.freeCases > 0
                    ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                    : 'border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFE9A3]'
                }`}
              >
                {bonus.freeCases > 0 ? 'Забрать' : 'за депозит от 200 ⭐'}
              </div>
            </article>

            {cases.map((caseItem) => {
              const isHot = caseItem.price === hottestPrice && hottestPrice > 0
              const bestPrize = getBestPrize(caseItem.prizes)
              const bestPrizeImg = bestPrize
                ? prizeImage(bestPrize.name, bestPrize.emoji, bestPrize.type)
                : FALLBACK_PRIZE_IMAGE

              return (
                <article
                  key={caseItem.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    tapFeedback('light')
                    onOpenCase(caseItem)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      tapFeedback('light')
                      onOpenCase(caseItem)
                    }
                  }}
                  className={`glass-card glass-card--hover group relative flex cursor-pointer flex-col items-center gap-2 overflow-hidden p-3.5 text-center transition hover:scale-[1.02] active:scale-[0.98] ${
                    isHot ? 'border-[#FFD700]/40 shadow-[0_0_24px_rgba(255,215,0,0.12)]' : ''
                  }`}
                >
                  <div className="relative mt-1 flex h-24 w-24 items-center justify-center">
                    <img
                      src={bestPrizeImg}
                      alt={bestPrize?.name ?? caseItem.name}
                      referrerPolicy="no-referrer"
                      className="h-24 w-24 object-contain transition-transform duration-300 group-hover:scale-105"
                      style={{
                        filter: 'drop-shadow(0 0 20px rgba(138, 43, 226, 0.6))',
                      }}
                      onError={(e) => {
                        const img = e.currentTarget
                        if (img.dataset.fallback !== '1') {
                          img.dataset.fallback = '1'
                          img.src = FALLBACK_PRIZE_IMAGE
                        }
                      }}
                    />
                  </div>

                  <h3 className="m-0 text-[15px] font-extrabold text-white">{caseItem.name}</h3>

                  <div className="flex items-center gap-1 text-sm font-extrabold text-[#FFD700]">
                    {caseItem.price}
                    <Star size={13} fill="currentColor" />
                  </div>

                  <div className="mt-1 flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 py-1.5 text-xs font-bold text-gray-300 transition group-hover:border-[#FFD700]/50 group-hover:text-white">
                    Содержимое
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <footer className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-400">
        <span
          className={`h-2 w-2 rounded-full ${
            connected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-gray-500'
          }`}
        />
        {!connectionRestored
          ? 'Проверяем кошелёк…'
          : connected
            ? 'TON-кошелёк активен'
            : 'Кошелёк не подключён'}
      </footer>
    </>
  )
}
