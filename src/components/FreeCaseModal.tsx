import { useCallback, useEffect, useState } from 'react'
import { Check, Gift, Send, Share2 } from 'lucide-react'
import type { ClaimDailyResponse } from '../api/types'
import { checkSubscription, claimDaily } from '../api/client'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'

const CHANNEL_URL = 'https://t.me/NewsGiftRoll'
const SHARE_URL = `https://t.me/share/url?url=${encodeURIComponent(
  CHANNEL_URL,
)}&text=${encodeURIComponent('Залетай в GiftRoll!')}`

interface TelegramWebAppBridge {
  openTelegramLink?: (url: string) => void
}

function getTelegramWebApp(): TelegramWebAppBridge | undefined {
  try {
    if (typeof window === 'undefined') {
      return undefined
    }
    return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppBridge } }).Telegram?.WebApp
  } catch {
    return undefined
  }
}

function openLink(url: string): void {
  const webApp = getTelegramWebApp()
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

export interface FreeCaseModalProps {
  onClose: () => void
  onClaimed: (result: ClaimDailyResponse) => void
}

/**
 * Условия бесплатного кейса: подписка на @NewsGiftRoll (проверяет сервер)
 * и нажатие «Поделиться». После успеха отдаём приз наверх — там крутится
 * та же анимация, что и для ежедневного бонуса.
 */
export default function FreeCaseModal({ onClose, onClaimed }: FreeCaseModalProps) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshSubscription = useCallback(async () => {
    try {
      const res = await checkSubscription()
      setSubscribed(res.subscribed)
    } catch {
      // Сеть моргнула — оставляем прежнее значение, проверим при следующем фокусе.
    }
  }, [])

  useEffect(() => {
    void refreshSubscription()

    // Возврат из канала/шеринга: окно снова стало активным — перепроверяем подписку.
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshSubscription()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refreshSubscription])

  const handleSubscribe = () => {
    tapFeedback('light')
    openLink(CHANNEL_URL)
    // Пользователь вернётся из канала — проверка уйдёт по focus/visibilitychange.
    window.setTimeout(() => void refreshSubscription(), 2000)
  }

  const handleShare = () => {
    tapFeedback('light')
    openLink(SHARE_URL)
    setShared(true)
  }

  const handleClaim = async () => {
    if (busy) {
      return
    }
    if (!subscribed) {
      errorFeedback()
      setNotice('Сначала подпишись на канал')
      return
    }
    if (!shared) {
      errorFeedback()
      setNotice('Нажми «Поделиться», чтобы забрать бонус')
      return
    }

    setBusy(true)
    setNotice(null)
    try {
      const res = await claimDaily()
      successFeedback()
      onClaimed(res)
    } catch (err: unknown) {
      errorFeedback()
      const code = (err as { code?: string } | null)?.code
      if (code === 'NOT_SUBSCRIBED') {
        setSubscribed(false)
        setNotice('Сначала подпишись на канал')
      } else if (code === 'BONUS_NOT_READY') {
        setNotice('Бонус ещё не доступен')
      } else {
        setNotice(err instanceof Error ? err.message : 'Не удалось забрать бонус')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="roulette" role="dialog" aria-modal="true" aria-label="Бесплатный кейс">
      <div className="roulette__backdrop" onClick={onClose} />

      <div className="roulette__panel">
        <h2 className="roulette__title inline-flex items-center justify-center gap-2">
          <Gift size={18} className="text-[#FFD700]" />
          Бесплатный кейс
        </h2>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="min-w-0">
              <p className="m-0 text-sm font-extrabold text-white">Подпишись на канал</p>
              <p className="m-0 text-xs text-gray-400">@NewsGiftRoll</p>
            </div>
            <button
              type="button"
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                subscribed
                  ? 'border border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                  : 'border border-[#48A9FF]/40 bg-[#48A9FF]/15 text-[#A9D8FF] hover:brightness-110'
              }`}
              onClick={handleSubscribe}
            >
              {subscribed ? <Check size={14} /> : <Send size={14} />}
              {subscribed ? 'Подписан' : 'Подписаться'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="min-w-0">
              <p className="m-0 text-sm font-extrabold text-white">Поделись с другом</p>
              <p className="m-0 text-xs text-gray-400">Отправь пост в Telegram</p>
            </div>
            <button
              type="button"
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                shared
                  ? 'border border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                  : 'border border-[#8A2BE2]/40 bg-[#8A2BE2]/20 text-violet-200 hover:brightness-110'
              }`}
              onClick={handleShare}
            >
              {shared ? <Check size={14} /> : <Share2 size={14} />}
              {shared ? 'Поделился' : 'Поделиться'}
            </button>
          </div>
        </div>

        {notice && (
          <p className="m-0 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs font-bold text-red-200">
            {notice}
          </p>
        )}

        <p className="m-0 text-center text-xs text-gray-400">
          {subscribed === null
            ? 'Проверяем подписку…'
            : subscribed
              ? 'Подписка подтверждена — можно забирать'
              : 'Подпишись на канал, чтобы открыть кейс'}
        </p>

        <button
          type="button"
          className="gold-btn w-full py-3.5 text-base"
          disabled={busy || subscribed === null}
          onClick={() => void handleClaim()}
        >
          {busy ? 'Забираем…' : 'Забрать бонус'}
        </button>

        <button
          type="button"
          className="ghost-btn w-full py-2.5 text-sm"
          onClick={() => {
            tapFeedback('light')
            onClose()
          }}
        >
          Закрыть
        </button>
      </div>
    </div>
  )
}
