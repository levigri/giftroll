import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Coins, Gem, Star, Wallet } from 'lucide-react'
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'
import {
  ApiError,
  depositGramsConfirm,
  depositGramsInvoice,
  depositCreateInvoice,
  depositCryptoInvoice,
  getDepositRates,
} from '../api/client'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'

/** Готовые суммы пополнения. */
const AMOUNTS = [50, 100, 250, 500, 1000, 2500]
/**
 * TON mainnet-адрес кошелька-получателя (дубль серверного TON_RECEIVER_ADDRESS).
 * Основной источник — поле receiverAddress из /api/deposit/grams/invoice,
 * чтобы адрес в платеже всегда совпадал с тем, что проверяет бэкенд.
 */
const TON_RECEIVER_ADDRESS = 'UQCrIF5c20wufcyh7AFWgzam5KtgZtXzbT2AuIblNHApbUAg'
/** Границы совпадают с серверными MIN_DEPOSIT_STARS / MAX_DEPOSIT_STARS. */
const MIN_AMOUNT = 10
const MAX_AMOUNT = 100_000
interface TelegramWebAppBridge {
  openInvoice?: (url: string, callback?: (status: string) => void) => void
  /** Открывает внешнюю ссылку внутри Telegram (например, счёт @CryptoBot). */
  openTelegramLink?: (url: string) => void
}

function getTelegramWebApp(): TelegramWebAppBridge | undefined {
  try {
    if (typeof window === 'undefined') {
      return undefined
    }
    return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppBridge } })?.Telegram?.WebApp
  } catch {
    return undefined
  }
}

export interface DepositPageProps {
  balance?: number | null
  /** Telegram ID текущего пользователя — по нему показывается DEV-блок. */
  userId?: string | null
  onRefreshMe?: () => Promise<void> | void
  onBack?: () => void
}

type ToastTone = 'ok' | 'error'
type Tab = 'stars' | 'grams' | 'crypto'

function formatDepositError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INVALID_AMOUNT':
        return `Сумма от ${MIN_AMOUNT} до ${MAX_AMOUNT} ⭐`
      case 'TELEGRAM_API_ERROR':
        return 'Telegram не создал счёт. Попробуй ещё раз'
      case 'TON_RECEIVER_NOT_CONFIGURED':
        return 'Пополнение Gram временно недоступно'
      case 'INVALID_TX':
        return 'Транзакция не найдена или её сумма не совпадает'
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

interface ErrorBoundaryProps {
  children: ReactNode
  onBack?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class DepositErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[DepositPage] Error caught by ErrorBoundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="flex flex-col items-center gap-4 py-8 text-center">
          {this.props.onBack && (
            <button
              type="button"
              className="ghost-btn flex items-center gap-1.5 self-start px-3 py-2 text-sm"
              onClick={this.props.onBack}
            >
              <ArrowLeft size={15} />
              Назад
            </button>
          )}
          <AlertTriangle size={32} className="text-[#FFD700]" />
          <h2 className="m-0 text-xl font-extrabold text-white">Ошибка загрузки страницы</h2>
          <p className="m-0 text-sm text-gray-400">
            {this.state.error?.message || 'Произошла непредвиденная ошибка при загрузке страницы пополнения.'}
          </p>
          <button
            type="button"
            className="gold-btn px-4 py-2.5 text-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Попробовать снова
          </button>
        </section>
      )
    }

    return this.props.children
  }
}

function DepositPageContent({
  balance = 0,
  onRefreshMe,
  onBack,
}: DepositPageProps) {
  const safeBalance = typeof balance === 'number' && !Number.isNaN(balance) ? balance : 0

  const [tab, setTab] = useState<Tab>('stars')
  const [amount, setAmount] = useState(100)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(null)

  /** Сколько звёзд хочет получить игрок во вкладке Gram. */
  const [gramsStars, setGramsStars] = useState('')
  const [gramsBusy, setGramsBusy] = useState(false)
  /** Базовый курс ($ за 100 ⭐) и живой курс TON — приходят с бэкенда. */
  const [rates, setRates] = useState<{ starsUsd: number; tonUsd: number }>({
    starsUsd: 1.4,
    tonUsd: 1.35,
  })
  /** Сумма пополнения криптой в ⭐ и флаг отправки счёта в @CryptoBot. */
  const [cryptoAmount, setCryptoAmount] = useState(100)
  const [cryptoBusy, setCryptoBusy] = useState(false)
  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()

  const amountValid = Number.isInteger(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT

  /** Игрок вводит сколько звёзд хочет получить — это и есть сумма депозита. */
  const gramsStarsNum = Number(gramsStars.replace(/[\s\u00a0]/g, ''))
  const gramsValid =
    Number.isInteger(gramsStarsNum) && gramsStarsNum >= MIN_AMOUNT && gramsStarsNum <= MAX_AMOUNT

  /** Сумма к оплате в Gram со скидкой 5% от базовой цены по курсу CoinGecko. */
  const gramsToPay = gramsValid
    ? Math.round((((gramsStarsNum / 100) * rates.starsUsd / rates.tonUsd) * 0.95) * 1_000_000) / 1_000_000
    : 0

  const cryptoValid =
    Number.isInteger(cryptoAmount) && cryptoAmount >= MIN_AMOUNT && cryptoAmount <= MAX_AMOUNT

  /** Счёт CryptoBot: база 100 ⭐ = $1.40 плюс комиссия шлюза 3%. */
  const cryptoBaseUsd = (cryptoAmount / 100) * rates.starsUsd
  const cryptoFinalUsd = cryptoBaseUsd * 1.03

  // Курсы берём у бэкенда (там CoinGecko без CORS-проблем) — один раз на открытие страницы.
  useEffect(() => {
    let alive = true
    void getDepositRates()
      .then((res) => {
        if (alive && Number.isFinite(res?.tonUsd) && res.tonUsd > 0) {
          setRates({ starsUsd: res.starsUsd, tonUsd: res.tonUsd })
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const showToast = (text: string, tone: ToastTone = 'ok') => {
    setToast({ text, tone })
    setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current))
    }, 4000)
  }

  const pickPreset = (value: number) => {
    tapFeedback('light')
    setAmount(value)
    setCustom('')
  }

  const handleCustom = (raw: string) => {
    setCustom(raw)
    const parsed = Number(raw.replace(',', '.'))
    if (Number.isInteger(parsed) && parsed >= MIN_AMOUNT && parsed <= MAX_AMOUNT) {
      setAmount(parsed)
    }
  }

  const handlePay = async () => {
    if (!amountValid) {
      showToast(`Сумма от ${MIN_AMOUNT} до ${MAX_AMOUNT} ⭐`, 'error')
      return
    }

    const paidAmount = amount
    tapFeedback('medium')
    setBusy(true)

    try {
      const { invoiceLink } = await depositCreateInvoice(paidAmount)
      const webApp = getTelegramWebApp()

      if (typeof webApp?.openInvoice === 'function') {
        try {
          webApp.openInvoice(invoiceLink, (status) => {
            if (status === 'paid') {
              successFeedback()
              showToast(`Успешно пополнено на ${paidAmount} ⭐`)
              void onRefreshMe?.()
            } else if (status === 'cancelled') {
              showToast('Оплата отменена', 'error')
            } else if (status === 'failed') {
              errorFeedback()
              showToast('Ошибка оплаты', 'error')
            }
          })
          return
        } catch (invoiceErr) {
          console.warn('[DepositPage] webApp.openInvoice failed, falling back to browser window:', invoiceErr)
        }
      }

      try {
        window.open?.(invoiceLink, '_blank', 'noopener')
      } catch {
        // ignore
      }
      showToast('Оплата доступна в Telegram — счёт открыт в браузере')
    } catch (err: unknown) {
      errorFeedback()
      showToast(formatDepositError(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleGramsPay = async () => {
    if (!gramsValid) {
      showToast(`Сумма от ${MIN_AMOUNT} до ${MAX_AMOUNT} ⭐`, 'error')
      return
    }
    if (!wallet) {
      showToast('Подключите кошелёк', 'error')
      return
    }

    tapFeedback('medium')
    setGramsBusy(true)

    try {
      const payStars = gramsStarsNum
      const { depositId, gramsAmount: invoiceGrams, receiverAddress } = await depositGramsInvoice(
        payStars,
      )
      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: '-239',
        messages: [
          {
            address: receiverAddress || TON_RECEIVER_ADDRESS,
            amount: String(Math.round(invoiceGrams * 1e9)),
          },
        ],
      }

      const result = await tonConnectUI.sendTransaction(transaction)
      const transactionBoc = (result as { boc?: string })?.boc
      if (!transactionBoc) {
        throw new Error('Кошелёк не вернул подписанную транзакцию')
      }

      const confirmResult = await depositGramsConfirm(depositId, transactionBoc)
      if (!confirmResult.ok) {
        throw new Error('Сервер не подтвердил зачисление')
      }
      successFeedback()
      showToast(`Пополнение на ${payStars} ⭐ зачислено`)
      void onRefreshMe?.()
      setGramsStars('')
    } catch (err: unknown) {
      // Пользователь отклонил транзакцию в кошельке (TonConnect code 300).
      const code = (err as { code?: number | string } | null)?.code
      const message = err instanceof Error ? err.message : ''
      const rejected = code === 300 || code === '300' || /reject/i.test(message)

      if (rejected) {
        tapFeedback('light')
        showToast('Транзакция отменена', 'error')
      } else {
        errorFeedback()
        showToast(formatDepositError(err), 'error')
      }
    } finally {
      setGramsBusy(false)
    }
  }

  /** Выставляет счёт в @CryptoBot и открывает его в Telegram. */
  const handleCryptoPay = async () => {
    if (!cryptoValid) {
      showToast(`Сумма от ${MIN_AMOUNT} до ${MAX_AMOUNT} ⭐`, 'error')
      return
    }

    const payAmount = cryptoAmount
    tapFeedback('medium')
    setCryptoBusy(true)

    try {
      const { invoiceLink } = await depositCryptoInvoice(payAmount)
      const webApp = getTelegramWebApp()

      if (webApp?.openTelegramLink) {
        webApp.openTelegramLink(invoiceLink)
      } else {
        window.open?.(invoiceLink, '_blank', 'noopener')
      }
    } catch (err: unknown) {
      errorFeedback()
      showToast(formatDepositError(err), 'error')
    } finally {
      setCryptoBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        {onBack && (
          <button
            type="button"
            className="ghost-btn flex h-9 w-9 shrink-0 items-center justify-center"
            onClick={onBack}
            aria-label="Назад"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 className="m-0 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white">
          <Gem size={21} className="text-[#FFD700]" />
          Пополнить баланс
        </h2>
      </div>

      <div className="glass-card flex items-center justify-between px-3.5 py-2.5 text-[13px] text-gray-400">
        Текущий баланс
        <strong className="inline-flex items-center gap-1 text-base font-extrabold text-white">
          <Star size={14} className="text-[#FFD700]" fill="currentColor" />
          {safeBalance.toLocaleString('ru-RU')}
        </strong>
      </div>

      {toast && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm font-semibold backdrop-blur-md ${
            toast.tone === 'ok'
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
          role="status"
        >
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Способ пополнения">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stars'}
          className={`rounded-xl border px-3 py-2 text-sm font-extrabold transition ${
            tab === 'stars'
              ? 'border-[#FFD700]/70 bg-[#FFD700]/15 text-[#FFE680] shadow-gold'
              : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#FFD700]/40 hover:text-white'
          }`}
          onClick={() => setTab('stars')}
        >
          <span className="inline-flex items-center gap-1.5"><Star size={14} fill="currentColor" /> Stars</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'grams'}
          className={`rounded-xl border px-3 py-2 text-sm font-extrabold transition ${
            tab === 'grams'
              ? 'border-[#48A9FF]/70 bg-[#48A9FF]/15 text-[#A9D8FF] shadow-[0_0_18px_rgba(72,169,255,0.18)]'
              : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#48A9FF]/40 hover:text-white'
          }`}
          onClick={() => setTab('grams')}
        >
          <span className="inline-flex items-center gap-1.5"><Gem size={14} /> Gram</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'crypto'}
          className={`rounded-xl border px-3 py-2 text-sm font-extrabold transition ${
            tab === 'crypto'
              ? 'border-[#FF6572]/70 bg-[#FF6572]/15 text-[#FFABB2] shadow-[0_0_18px_rgba(255,101,114,0.18)]'
              : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#FF6572]/40 hover:text-white'
          }`}
          onClick={() => setTab('crypto')}
        >
          <span className="inline-flex items-center gap-1.5"><Coins size={14} /> Crypto</span>
        </button>
      </div>

      {tab === 'stars' && (
        <>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Сумма пополнения">
            {AMOUNTS.map((value) => {
              const active = amount === value && custom === ''
              return (
                <button
                  key={value}
                  type="button"
                  className={`flex items-center justify-center gap-1 rounded-xl border py-2.5 text-sm font-extrabold transition ${
                    active
                      ? 'border-[#FFD700]/70 bg-[#FFD700]/15 text-[#FFE680] shadow-gold'
                      : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#FFD700]/40 hover:text-white'
                  }`}
                  aria-pressed={active}
                  onClick={() => pickPreset(value)}
                >
                  {value.toLocaleString('ru-RU')}
                  <Star size={12} className="text-[#FFD700]" fill="currentColor" />
                </button>
              )
            })}
          </div>

          <label className="glass-card flex flex-col gap-1.5 px-3.5 py-3">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
              Своя сумма
            </span>
            <input
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-base font-bold text-white outline-none transition placeholder:text-gray-500 focus:border-[#FFD700]/70"
              type="number"
              inputMode="numeric"
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step={1}
              value={custom}
              placeholder={`${MIN_AMOUNT}–${MAX_AMOUNT}`}
              onChange={(event) => handleCustom(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="gold-btn flex items-center justify-center gap-1.5 py-3.5 text-base"
            disabled={busy || !amountValid}
            onClick={() => void handlePay()}
          >
            {busy ? (
              'Создаём счёт…'
            ) : (
              <>
                Пополнить на {amountValid ? amount.toLocaleString('ru-RU') : '—'}
                <Star size={16} fill="currentColor" />
              </>
            )}
          </button>

          <p className="m-0 px-1 text-center text-[12px] leading-relaxed text-gray-400">
            Оплата проходит через Telegram Stars. Звёзды зачисляются на баланс сразу после оплаты и
            отыгрываются в игре.
          </p>
        </>
      )}

      {tab === 'grams' && (
        <>
          <div className="flex items-center justify-between rounded-2xl border border-[#48A9FF]/25 bg-gradient-to-r from-[#48A9FF]/10 to-emerald-400/10 px-3.5 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-extrabold text-white">Оплата в Gram</div>
                <span className="ml-2 text-sm font-bold text-emerald-400">+5% Бонус</span>
              </div>
            </div>
            <span className="rounded-full border border-[#48A9FF]/30 bg-[#48A9FF]/10 px-2.5 py-1 text-xs font-extrabold text-[#A9D8FF]">TON</span>
          </div>
          {!wallet ? (
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-xl border border-[#48A9FF]/35 bg-[#48A9FF]/15 py-3.5 text-base font-extrabold text-[#A9D8FF] transition hover:bg-[#48A9FF]/25"
              onClick={() => void tonConnectUI.openModal()}
            >
              <Wallet size={16} />
              Подключить кошелёк
            </button>
          ) : (
            <>
              <label className="glass-card flex flex-col gap-1.5 px-3.5 py-3">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                  Сколько звёзд получить
                </span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-base font-bold text-white outline-none transition placeholder:text-gray-500 focus:border-[#48A9FF]/70"
                  type="number"
                  inputMode="numeric"
                  min={MIN_AMOUNT}
                  max={MAX_AMOUNT}
                  step={1}
                  value={gramsStars}
                  placeholder={`${MIN_AMOUNT}–${MAX_AMOUNT}`}
                  onChange={(event) => setGramsStars(event.target.value)}
                />
              </label>

              {gramsValid && (
                <p className="m-0 rounded-xl border border-[#48A9FF]/20 bg-[#48A9FF]/[0.06] px-3 py-2 text-center text-[12px] leading-relaxed text-gray-300">
                  К оплате: <strong className="text-white">~{gramsToPay.toFixed(3)} Gram</strong>{' '}
                  (с учетом скидки 5%)
                </p>
              )}

              <button
                type="button"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-[#48A9FF]/35 bg-gradient-to-r from-[#48A9FF] to-[#397FE6] py-3.5 text-base font-extrabold text-white shadow-[0_8px_28px_rgba(59,130,246,0.22)] transition hover:brightness-110 disabled:opacity-50"
                disabled={gramsBusy || !gramsValid}
                onClick={() => void handleGramsPay()}
              >
                {gramsBusy ? 'Обработка…' : 'Пополнить'}
              </button>
            </>
          )}
        </>
      )}

      {tab === 'crypto' && (
        <>
          <div className="flex items-center justify-between rounded-2xl border border-[#48A9FF]/25 bg-gradient-to-r from-[#48A9FF]/10 to-[#FF6572]/10 px-3.5 py-3">
            <div>
              <div className="text-sm font-extrabold text-white">Оплата криптовалютой</div>
            </div>
            <span className="rounded-full border border-[#48A9FF]/30 bg-[#48A9FF]/10 px-2.5 py-1 text-xs font-extrabold text-[#A9D8FF]">
              USDT
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Сумма пополнения криптой">
            {AMOUNTS.map((value) => {
              const active = cryptoAmount === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  className={`flex items-center justify-center gap-1 rounded-xl border py-2.5 text-sm font-extrabold transition ${
                    active
                      ? 'border-[#48A9FF]/70 bg-[#48A9FF]/15 text-[#A9D8FF] shadow-[0_0_18px_rgba(72,169,255,0.18)]'
                      : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#48A9FF]/40 hover:text-white'
                  }`}
                  onClick={() => {
                    tapFeedback('light')
                    setCryptoAmount(value)
                  }}
                >
                  {value.toLocaleString('ru-RU')}
                  <Star size={12} className="text-[#FFD700]" fill="currentColor" />
                </button>
              )
            })}
          </div>

          <label className="glass-card flex flex-col gap-1.5 px-3.5 py-3">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
              Сколько звёзд купить
            </span>
            <input
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-base font-bold text-white outline-none transition placeholder:text-gray-500 focus:border-[#48A9FF]/70"
              type="number"
              inputMode="numeric"
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step={1}
              value={cryptoAmount || ''}
              placeholder={`${MIN_AMOUNT}–${MAX_AMOUNT}`}
              onChange={(event) => {
                const parsed = Number(event.target.value)
                setCryptoAmount(Number.isFinite(parsed) ? parsed : 0)
              }}
            />
          </label>

          {cryptoValid && (
            <p className="m-0 rounded-xl border border-[#48A9FF]/20 bg-[#48A9FF]/[0.06] px-3 py-2 text-center text-[12px] leading-relaxed text-gray-300">
              К оплате: <strong className="text-white">~${cryptoFinalUsd.toFixed(3)}</strong>{' '}
              (базовая ${cryptoBaseUsd.toFixed(2)} + 3%)
            </p>
          )}

          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-[#48A9FF]/35 bg-gradient-to-r from-[#48A9FF] to-[#397FE6] py-3.5 text-base font-extrabold text-white shadow-[0_8px_28px_rgba(59,130,246,0.22)] transition hover:brightness-110 disabled:opacity-50"
            disabled={cryptoBusy || !cryptoValid}
            onClick={() => void handleCryptoPay()}
          >
            <Coins size={16} />
            {cryptoBusy
              ? 'Создаём счёт…'
              : `Оплатить криптовалютой · ${cryptoAmount.toLocaleString('ru-RU')} ⭐`}
          </button>

          <p className="m-0 px-1 text-center text-[12px] leading-relaxed text-gray-400">
            После оплаты вернитесь в приложение. Баланс обновится автоматически.
          </p>
        </>
      )}

    </section>
  )
}


export default function DepositPage(props: DepositPageProps) {
  return (
    <DepositErrorBoundary onBack={props.onBack}>
      <DepositPageContent {...props} />
    </DepositErrorBoundary>
  )
}
