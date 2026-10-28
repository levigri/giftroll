import { useState } from 'react'
import { Gauge, Package, Swords } from 'lucide-react'
import type { CaseItem } from '../api/types'
import CasesPage from './CasesPage'
import UpgraderPage from './UpgraderPage'
import PvpPage from './PvpPage'
import { tapFeedback } from '../telegram'

export type GamesTab = 'cases' | 'upgrader' | 'pvp'

const GAME_TABS: { id: GamesTab; icon: typeof Package; label: string }[] = [
  { id: 'cases', icon: Package, label: 'Кейсы' },
  { id: 'upgrader', icon: Gauge, label: 'Апгрейдер' },
  { id: 'pvp', icon: Swords, label: 'PvP' },
]

export interface GamesPageProps {
  balance: number
  onRefreshMe: () => Promise<void> | void
  onBalanceChange: (newBalance: number) => void
  cases: CaseItem[]
  loading: boolean
  onOpenCase: (caseItem: CaseItem) => void
  connected: boolean
  walletLabel: string | null
  connectionRestored: boolean
  onConnect: () => void
}

/** Вкладка «Игры»: кейсы, апгрейдер и PvP под общим переключателем. */
export default function GamesPage({
  balance,
  onRefreshMe,
  onBalanceChange,
  cases,
  loading,
  onOpenCase,
  connected,
  walletLabel,
  connectionRestored,
  onConnect,
}: GamesPageProps) {
  const [game, setGame] = useState<GamesTab>('cases')

  return (
    <div className="flex flex-col gap-3.5">
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
          />
        )}

        {game === 'upgrader' && (
          <UpgraderPage
            balance={balance}
            onRefreshMe={onRefreshMe}
            onBalanceChange={onBalanceChange}
          />
        )}

        {game === 'pvp' && (
          <PvpPage
            balance={balance}
            onRefreshMe={onRefreshMe}
            onBalanceChange={onBalanceChange}
          />
        )}
      </div>
    </div>
  )
}
