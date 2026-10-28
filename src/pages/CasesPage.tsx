import { Star, Wallet } from 'lucide-react'
import type { CaseItem } from '../api/types'
import { tapFeedback } from '../telegram'
import { FALLBACK_PRIZE_IMAGE, getBestPrize, prizeImage } from '../utils/assets'

/** Сколько кейсов открывать за один клик. */
export type OpenCount = 1 | 2 | 5

export const OPEN_COUNTS: OpenCount[] = [1, 2, 5]

export interface CasesPageProps {
  cases: CaseItem[]
  loading: boolean
  onOpenCase: (caseItem: CaseItem) => void
  connected: boolean
  walletLabel: string | null
  connectionRestored: boolean
  onConnect: () => void
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
}: CasesPageProps) {
  const hottestPrice = cases.reduce((max, item) => Math.max(max, item.price), 0)

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
