import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useIsConnectionRestored,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react'
import { Backpack, Gamepad2, Gift, Plus, Star, User, Users } from 'lucide-react'
import type { CaseItem, DailyBonusPrize, MeResponse, Prize } from './api/types'
import {
  ApiError,
  claimDaily,
  getCases,
  getMe,
  openCase as openCaseApi,
  openMultiCase as openMultiCaseApi,
} from './api/client'
import {
  captureStartParamRef,
  errorFeedback,
  getTelegramUser,
  isTelegramEnv,
  successFeedback,
  tapFeedback,
} from './telegram'
import RouletteModal from './components/RouletteModal'
import InventoryModal from './components/InventoryModal'
import DailyBonusModal from './components/DailyBonusModal'
import LiveFeed from './components/LiveFeed'
import GamesPage from './pages/GamesPage'
import type { OpenCount } from './pages/CasesPage'
import ReferralPage from './pages/ReferralPage'
import DepositPage from './pages/DepositPage'
import './App.css'

/**
 * Вкладки нижней навигации.
 * 'deposit' — отдельная страница без вкладки: открывается кнопкой «Пополнить».
 */
type TabId = 'games' | 'referral' | 'inventory' | 'profile' | 'deposit'

const TABS: { id: TabId; icon: typeof Gamepad2; label: string }[] = [
  { id: 'games', icon: Gamepad2, label: 'Игры' },
  { id: 'referral', icon: Users, label: 'Друзья' },
  { id: 'inventory', icon: Backpack, label: 'Инвентарь' },
  { id: 'profile', icon: User, label: 'Профиль' },
]

/**
 * Мини-роутинг без react-router: #/deposit и #/referral,
 * плюс прямые пути /deposit и /referral, если хостинг отдаёт index.html.
 */
function readRoute(): 'deposit' | 'referral' | null {
  try {
    const rawHash = window.location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '')
    if (rawHash === 'deposit' || rawHash === 'referral') {
      return rawHash
    }

    const path = window.location.pathname.replace(/\/+$/, '')
    if (path === '/deposit' || path.endsWith('/deposit')) {
      return 'deposit'
    }
    if (path === '/referral' || path.endsWith('/referral')) {
      return 'referral'
    }
  } catch {
    // ignore
  }
  return null
}

function writeRoute(route: 'deposit' | 'referral' | null): void {
  const base = `${window.location.pathname}${window.location.search}`
  const next = route ? `${base}#/${route}` : base

  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === next) {
    return
  }
  window.history.replaceState(null, '', next)
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INSUFFICIENT_FUNDS':
        return 'Недостаточно средств'
      case 'BONUS_NOT_READY':
        return 'Бонус ещё не доступен'
      case 'ITEM_NOT_FOUND':
        return 'Предмет не найден'
      case 'CASE_NOT_FOUND':
        return 'Кейс не найден'
      case 'AUTH_MISSING':
      case 'AUTH_INVALID':
        return 'Ошибка авторизации Telegram'
      default:
        return err.message
    }
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

function App() {
  const [tonConnectUI] = useTonConnectUI()

  useEffect(() => {
    const unsubscribe = tonConnectUI.onStatusChange(
      () => {},
      (error) => {
        const errorDetails = error as Error & {
          code?: number | string
          cause?: { code?: number | string; message?: string }
        }

        console.error('❌ [TON] Ошибка подключения:', error)
        console.error(
          'Код:',
          errorDetails.code ?? errorDetails.cause?.code,
          'Сообщение:',
          errorDetails.message ?? errorDetails.cause?.message,
        )
      },
    )

    return () => unsubscribe()
  }, [tonConnectUI])

  const wallet = useTonWallet()
  const connectionRestored = useIsConnectionRestored()

  const [me, setMe] = useState<MeResponse | null>(null)
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeCase, setActiveCase] = useState<CaseItem | null>(null)
  const [showInventory, setShowInventory] = useState(false)

  const [dailyBonusPrize, setDailyBonusPrize] = useState<DailyBonusPrize | null>(null)
  const [showDailyBonus, setShowDailyBonus] = useState(false)
  const [tab, setTab] = useState<TabId>(() => readRoute() ?? 'games')
  /** Куда вернуть с DepositPage, если открыли его из вкладки. */
  const [depositReturnTab, setDepositReturnTab] = useState<TabId>('games')

  const tgUser = getTelegramUser()
  const inTelegram = isTelegramEnv()

  /** Ошибку привязки по реф-ссылке показываем один раз за запуск. */
  const referralNoticeShown = useRef(false)

  const showToastError = (msg: unknown) => {
    const text = formatErrorMessage(msg)
    setError(text)
    setTimeout(() => {
      setError((current) => (current === text ? null : current))
    }, 3000)
  }

  const showReferralNotice = (reason: string) => {
    const text = `Реферальная ссылка не засчитана: ${reason}`
    const webApp = (
      window as unknown as { Telegram?: { WebApp?: { showAlert?: (message: string) => void } } }
    ).Telegram?.WebApp

    if (webApp?.showAlert) {
      webApp.showAlert(text)
      return
    }

    showToastError(text)
  }

  const loadInitialData = async () => {
    try {
      setLoading(true)
      const [meData, casesData] = await Promise.all([getMe(), getCases()])

      // Бэкенд вернул итог привязки по X-Ref-Code — если не засчиталось, объясняем почему.
      if (meData.referral && !meData.referral.ok && !referralNoticeShown.current) {
        referralNoticeShown.current = true
        showReferralNotice(meData.referral.reason ?? 'ссылка не засчитана')
      }

      setMe(meData)
      setCases(casesData.cases)
      setError(null)
    } catch (err: unknown) {
      setError(formatErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Стабильный колбэк: его держит в зависимостях страница PvP.
  const refreshMe = useCallback(async () => {
    try {
      const freshMe = await getMe()
      setMe(freshMe)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    captureStartParamRef()
    void loadInitialData()
  }, [])

  // Прямые ссылки #/deposit и #/referral и аппаратная кнопка «назад».
  useEffect(() => {
    const sync = () => {
      const route = readRoute()
      setTab((current) => {
        if (route) {
          return route
        }
        return current === 'deposit' || current === 'referral' ? 'games' : current
      })
    }

    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const handleTab = (next: TabId) => {

    if (next === tab) {
      return
    }

    tapFeedback('light')

    if (readRoute() !== null) {
      writeRoute(null)
    }

    // Ставка в PvP списана при входе в лобби, поэтому смена вкладки игру не отменяет.
    setTab(next)
  }

  const openDeposit = () => {
    if (tab !== 'deposit') {
      setDepositReturnTab(tab)
    }
    tapFeedback('light')
    writeRoute('deposit')
    setTab('deposit')
  }

  const closeDeposit = () => {
    writeRoute(null)
    setTab(depositReturnTab)
  }

  const handleConnect = () => {
    tapFeedback('light')
    void tonConnectUI.openModal().catch((err: unknown) => {
      console.warn('[GiftRoll] TonConnect modal error:', err)
    })
  }

  const handleDailyBonus = async () => {
    if (!me) {
      return
    }

    tapFeedback('light')
    try {
      const res = await claimDaily()
      setMe((prev) =>
        prev
          ? {
              ...prev,
              balance: res.newBalance,
              dailyBonusAvailable: false,
            }
          : null,
      )
      setDailyBonusPrize(res.prize)
      setShowDailyBonus(true)
      successFeedback()
    } catch (err: unknown) {
      errorFeedback()
      showToastError(err instanceof Error ? err.message : 'Ошибка бонуса')
    }
  }

  /**
   * Открывает count кейсов и возвращает выпавшие призы — рулетка в модалке
   * сама решает, сколько лент крутить. ×1 идёт через обычный эндпоинт.
   */
  const openCaseBatch = useCallback(
    async (caseItem: CaseItem, count: OpenCount): Promise<Prize[]> => {
      if (count === 1) {
        const res = await openCaseApi(caseItem.id)
        setMe((prev) =>
          prev
            ? {
                ...prev,
                balance: res.newBalance,
                inventoryCount:
                  res.prize.type === 'NFT' ? prev.inventoryCount + 1 : prev.inventoryCount,
              }
            : null,
        )
        successFeedback()
        void refreshMe()
        return [res.prize]
      }

      const res = await openMultiCaseApi(caseItem.id, count)
      // Звёздные призы уже зачислены сервером, в инвентарь идут только NFT.
      const nftCount = res.results.filter((item) => item.type === 'NFT').length
      setMe((prev) =>
        prev
          ? {
              ...prev,
              balance: res.newBalance,
              inventoryCount: prev.inventoryCount + nftCount,
            }
          : null,
      )
      successFeedback()
      void refreshMe()

      return res.results.map((item) => ({
        id: item.prizeId,
        name: item.name,
        emoji: item.emoji,
        type: item.type,
        price: item.price,
      }))
    },
    [refreshMe],
  )

  const handleSelectCase = (caseItem: CaseItem) => {
    tapFeedback('light')
    setActiveCase(caseItem)
  }

  const closeRoulette = async () => {
    setActiveCase(null)
    await refreshMe()
  }

  const userName = me?.firstName?.trim() || tgUser?.first_name?.trim() || 'Игрок'
  const userPhoto = me?.photoUrl || tgUser?.photo_url

  const connected = !!wallet
  const walletLabel = wallet ? shortAddress(wallet.account.address) : null

  return (
    <div className="min-h-screen bg-[#0B0C10] font-sans text-white">
      <div className="relative mx-auto min-h-screen max-w-[430px] overflow-x-hidden bg-[#0B0C10] bg-[radial-gradient(120%_60%_at_50%_-10%,rgba(138,43,226,0.2),transparent_65%)] shadow-[0_0_80px_rgba(138,43,226,0.18)]">
        <div className="app">
      {!inTelegram && (
        <div className="mx-[-16px] mt-[-16px] bg-gradient-to-r from-[#FFD700] to-[#FFA500] px-3 py-1.5 text-center text-[13px] font-extrabold text-[#1a1400]" role="status">
          Открой через бота @GiftRollBot
        </div>
      )}

      {error && (
        <div
          className="fixed left-1/2 top-3 z-[1100] flex w-[calc(100%-32px)] max-w-[398px] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-[#2a0f12]/90 px-3.5 py-2.5 text-[13px] font-semibold text-red-200 backdrop-blur-md"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="border-0 bg-transparent text-lg leading-none text-red-200/80 transition hover:text-white"
            aria-label="Закрыть уведомление"
          >
            ×
          </button>
        </div>
      )}

      <header className="glass-card flex items-center gap-3 px-3 py-2.5">
        {loading && !me ? (
          <div className="text-sm font-bold text-gray-400">Загрузка профиля...</div>
        ) : !me ? (
          <button type="button" className="gold-btn px-4 py-2 text-sm" onClick={() => void loadInitialData()}>
            Повторить попытку
          </button>
        ) : (
          <>
            {userPhoto ? (
              <img
                className="h-11 w-11 rounded-full object-cover ring-2 ring-[#FFD700]/40"
                src={userPhoto}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#8A2BE2] to-[#4c1d95] text-base font-extrabold">
                {userName.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">GiftRoll</p>
              <p className="m-0 truncate text-[16px] font-extrabold text-white">{userName}</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 py-1 pl-2.5 pr-1 backdrop-blur-md">
              <Star size={14} className="text-[#FFD700]" fill="currentColor" />
              <span className="text-sm font-extrabold tabular-nums text-white">{me.balance.toLocaleString('ru-RU')}</span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-[#1a1400] shadow-gold"
                onClick={openDeposit}
                title="Пополнить баланс"
              >
                <Plus size={14} strokeWidth={3} />
              </button>
            </div>
          </>
        )}
      </header>

      {me?.dailyBonusAvailable && (
        <button
          type="button"
          className="gold-btn flex w-full items-center justify-center gap-2 py-2.5 text-sm"
          onClick={() => void handleDailyBonus()}
        >
          <Gift size={16} />
          Ежедневный бонус
        </button>
      )}

      <LiveFeed />

      <main className="app__main">
        {tab === 'games' && (
          <GamesPage
            balance={me?.balance ?? 0}
            onRefreshMe={refreshMe}
            onBalanceChange={(newBalance) =>
              setMe((prev) => (prev ? { ...prev, balance: newBalance } : null))
            }
            cases={cases}
            loading={loading}
            onOpenCase={handleSelectCase}
            connected={connected}
            walletLabel={walletLabel}
            connectionRestored={connectionRestored}
            onConnect={handleConnect}
          />
        )}

        {tab === 'inventory' && (
          <InventoryModal
            variant="page"
            onClose={() => setTab('games')}
            onBalanceChange={(newBalance) =>
              setMe((prev) => (prev ? { ...prev, balance: newBalance } : null))
            }
            onCountChange={(newCount) =>
              setMe((prev) => (prev ? { ...prev, inventoryCount: newCount } : null))
            }
          />
        )}

        {tab === 'profile' && (
          <section className="profile">
            {!me ? (
              <div className="app__loading">Профиль недоступен</div>
            ) : (
              <>
                <div className="profile__card glass-card">
                  {userPhoto ? (
                    <img
                      className="profile__avatar"
                      src={userPhoto}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="profile__avatar profile__avatar--placeholder" aria-hidden="true">
                      {userName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="profile__name">{userName}</div>
                  <div className="profile__username">
                    {me.username ? `@${me.username}` : 'username не задан'}
                  </div>
                </div>

                <div className="profile__rows">
                  <div className="profile__row">
                    <span>Telegram ID</span>
                    <strong>{me.id}</strong>
                  </div>
                  <div className="profile__row">
                    <span>Баланс</span>
                    <strong className="inline-flex items-center gap-1">
                      <Star size={14} className="text-[#FFD700]" fill="currentColor" />
                      {me.balance}
                    </strong>
                  </div>
                  <div className="profile__row">
                    <span>NFT в инвентаре</span>
                    <strong>{me.inventoryCount}</strong>
                  </div>
                  <div className="profile__row">
                    <span>TON-кошелёк</span>
                    <strong>{connected ? walletLabel : 'не подключён'}</strong>
                  </div>
                  <div className="profile__row">
                    <span>В игре с</span>
                    <strong>{new Date(me.createdAt).toLocaleDateString('ru-RU')}</strong>
                  </div>
                </div>

                <button type="button" className="gold-btn py-3.5" onClick={openDeposit}>
                  Пополнить баланс
                </button>

                <button type="button" className="ghost-btn py-3.5 text-sm" onClick={handleConnect}>
                  {connected ? 'Кошелёк подключён' : 'Подключить кошелёк'}
                </button>
              </>
            )}
          </section>
        )}

        {tab === 'referral' && <ReferralPage />}

        {tab === 'deposit' && (
          <DepositPage
            balance={me?.balance ?? 0}
            userId={me?.id ?? null}
            onRefreshMe={refreshMe}
            onBack={closeDeposit}
          />
        )}
      </main>

      <nav
        className="fixed bottom-0 left-1/2 z-[900] flex w-full max-w-[430px] -translate-x-1/2 gap-1 border-t border-white/10 bg-[#0B0C10]/90 px-2 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl"
        aria-label="Навигация"
      >
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-extrabold tracking-tight transition duration-150 ${
                active
                  ? 'bg-gradient-to-b from-[#FFD700]/15 to-transparent text-[#FFD700]'
                  : 'text-gray-400 hover:text-white'
              }`}
              aria-current={active ? 'page' : undefined}
              onClick={() => handleTab(item.id)}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.4 : 2}
                className={active ? 'drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]' : ''}
              />
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {activeCase && (
        <RouletteModal
          caseItem={activeCase}
          balance={me?.balance ?? 0}
          onClose={() => void closeRoulette()}
          onOpen={(count) => openCaseBatch(activeCase, count)}
        />
      )}

      {showInventory && tab !== 'inventory' && (
        <InventoryModal
          onClose={() => setShowInventory(false)}
          onBalanceChange={(newBalance) =>
            setMe((prev) => (prev ? { ...prev, balance: newBalance } : null))
          }
          onCountChange={(newCount) =>
            setMe((prev) => (prev ? { ...prev, inventoryCount: newCount } : null))
          }
        />
      )}

      {showDailyBonus && dailyBonusPrize && (
        <DailyBonusModal
          winningPrize={dailyBonusPrize}
          onClose={() => {
            setShowDailyBonus(false)
            setDailyBonusPrize(null)
            void refreshMe()
          }}
        />
      )}
        </div>
      </div>
    </div>
  )
}

export default App
