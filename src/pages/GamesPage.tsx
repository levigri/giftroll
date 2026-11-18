import { useState } from 'react'
import { Gauge, Package, Swords } from 'lucide-react'
import type { CaseItem, GameCurrency, MeResponse, PromoOpenResponse } from '../api/types'
import CasesPage from './CasesPage'
import UpgraderPage from './UpgraderPage'
import PvpPage from './PvpPage'
import { tapFeedback } from '../telegram'
import { formatCurrency } from '../utils/gameCurrency'

export type GamesTab = 'cases' | 'upgrader' | 'pvp'

const GAME_TABS: { id: GamesTab; icon: typeof Package; label: string }[] = [
  { id: 'cases', icon: Package, label: 'Кейсы' },
  { id: 'upgrader', icon: Gauge, label: 'Апгрейдер' },
  { id: 'pvp', icon: Swords, label: 'PvP' },
]

export interface GamesPageProps {
  balance: number
  balances: { STARS: number; GRAMS: number; CRYPTO: number }
  gameCurrency: GameCurrency
  conversionFactor: number
  onCurrencyChange: (currency: GameCurrency) => void
  onRefreshMe: () => Promise<void> | void
  onBalanceChange: (currency: GameCurrency, newBalance: number) => void
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
  onPromoOpened: (result: PromoOpenResponse) => void
  me: MeResponse | null
}

/** Состояние бонусных кейсов в сетке кейсов. */
export interface BonusState {
  dailyAvailable: boolean
  /** Когда откроется следующий ежедневный кейс; null — если уже доступен. */
  dailyAvailableAt: string | null
}

/** Вкладка «Игры»: кейсы, апгрейдер и PvP под общим переключателем. */
export default function GamesPage({
  balance,
  balances,
  gameCurrency,
  conversionFactor,
  onCurrencyChange,
  onRefreshMe,
  onBalanceChange,
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
  onPromoOpened,
  me,
}: GamesPageProps) {
  const [game, setGame] = useState<GamesTab>('cases')
  const [currencyLocked, setCurrencyLocked] = useState(false)

  return (
    <div className="flex flex-col gap-3.5">
      <section className="glass-card flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-400">Баланс для игры</span>
          <strong className="text-sm font-extrabold text-white">
            {formatCurrency(balance, gameCurrency)}
          </strong>
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Игровая валюта">
          {([
            ['STARS', '⭐ Stars'],
            ['GRAMS', '💎 Gram'],
            ['CRYPTO', '₮ Crypto'],
          ] as const).map(([currency, label]) => (
            <button
              key={currency}
              type="button"
              aria-pressed={gameCurrency === currency}
              disabled={currencyLocked}
              onClick={() => {
                if (gameCurrency !== currency) {
                  tapFeedback('light')
                  onCurrencyChange(currency)
                }
              }}
              className={`rounded-xl border px-2 py-2 text-[11px] font-extrabold transition ${
                gameCurrency === currency
                  ? 'border-[#FFD700]/60 bg-[#FFD700]/10 text-[#FFE680]'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'
              } ${currencyLocked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span className="block">{label}</span>
              <span className="mt-0.5 block text-[10px] font-semibold opacity-75">
                {formatCurrency(balances[currency], currency)}
              </span>
            </button>
          ))}
        </div>
        {gameCurrency !== 'STARS' && (
          <p className="m-0 text-[10px] text-gray-500">
            Цены в эквиваленте по текущему курсу пополнения.
            {gameCurrency === 'CRYPTO' ? ' Crypto-баланс указан в USD.' : ''}
          </p>
        )}
      </section>

      <div
        className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-md"
        role="tablist"
        aria-label="Игры"
      >
        {GAME_TABS.map((item) => {
          const Icon = item.icon
          const active = game === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-extrabold transition duration-150 ${
                active
                  ? 'border-[#8A2BE2] bg-[#8A2BE2]/25 text-white shadow-violet'
                  : 'border-transparent text-gray-400 hover:border-[#8A2BE2]/40 hover:text-white'
              }`}
              onClick={() => {
                if (game === item.id) {
                  return
                }
                tapFeedback('light')
                setGame(item.id)
              }}
            >
              <Icon size={14} />
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3">
        {game === 'cases' && (
          <CasesPage
            cases={cases}
            loading={loading}
            onOpenCase={onOpenCase}
            connected={connected}
            walletLabel={walletLabel}
            connectionRestored={connectionRestored}
            onConnect={onConnect}
            bonus={bonus}
            onOpenFreeCase={onOpenFreeCase}
            onClaimDepositBonus={onClaimDepositBonus}
            onPromoOpened={onPromoOpened}
            me={me}
            gameCurrency={gameCurrency}
            conversionFactor={conversionFactor}
          />
        )}

        {game === 'upgrader' && (
          <UpgraderPage
            balance={balance}
            currency={gameCurrency}
            conversionFactor={conversionFactor}
            isBetaMode={me?.isBetaMode ?? false}
            onRefreshMe={onRefreshMe}
            onBalanceChange={(newBalance) => onBalanceChange(gameCurrency, newBalance)}
          />
        )}

        {game === 'pvp' && (
          <PvpPage
            balance={balance}
            currency={gameCurrency}
            conversionFactor={conversionFactor}
            onRefreshMe={onRefreshMe}
            onBalanceChange={onBalanceChange}
            onCurrencyLock={setCurrencyLocked}
            onCurrencyChange={onCurrencyChange}
            isBetaMode={me?.isBetaMode ?? false}
          />
        )}
      </div>
    </div>
  )
}
