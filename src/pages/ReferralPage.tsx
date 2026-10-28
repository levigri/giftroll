import { useEffect, useState } from 'react'
import { Check, Copy, Share2, Star, UserPlus, Users } from 'lucide-react'
import type { ReferralStats } from '../api/types'
import { getReferralStats } from '../api/client'
import { tapFeedback } from '../telegram'

/** Страница «Друзья» обновляется нечасто: начисления приходят от чужих трат. */
const POLL_MS = 10_000
const FALLBACK_BOT_USERNAME = 'Giftrollgamebot'
const SHARE_TEXT = 'Играй в GiftRoll и получай NFT!'

type ToastTone = 'ok' | 'error'

interface TelegramWebAppBridge {
  openTelegramLink?: (url: string) => void
}

function telegramWebApp(): TelegramWebAppBridge | undefined {
  return (
    window as unknown as { Telegram?: { WebApp?: TelegramWebAppBridge } }
  ).Telegram?.WebApp
}

/** «только что» / «N мин назад» / «N ч назад» / дата. */
function relativeTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return ''
  }

  const diff = Date.now() - time
  if (diff < 60_000) {
    return 'только что'
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} мин назад`
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} ч назад`
  }
  return new Date(time).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** Player #1234 — хвост Telegram ID, полный id в интерфейсе не нужен. */
function playerLabel(referredId: string): string {
  return `Player #${referredId.slice(-4)}`
}

/** @username → firstName → Player #ID. */
function personName(
  personId: string,
  username?: string | null,
  firstName?: string | null,
): string {
  const handle = username?.trim()
  if (handle) {
    return `@${handle.replace(/^@/, '')}`
  }

  const name = firstName?.trim()
  if (name) {
    return name
  }

  return playerLabel(personId)
}

function formatDate(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return ''
  }
  return new Date(time).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

export default function ReferralPage() {
  const botUsername = import.meta.env.VITE_BOT_USERNAME?.trim() ?? ''
  const effectiveBot = botUsername || FALLBACK_BOT_USERNAME

  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(null)

  useEffect(() => {
    if (!botUsername) {
      console.warn(
        `[Referral] VITE_BOT_USERNAME не задан — используется заглушка ${FALLBACK_BOT_USERNAME}`,
      )
    }
  }, [botUsername])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const next = await getReferralStats()
        if (cancelled) {
          return
        }
        setStats(next)
        setError(null)
      } catch (err: unknown) {
        if (cancelled) {
          return
        }
        setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const showToast = (text: string, tone: ToastTone = 'ok') => {
    setToast({ text, tone })
    setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current))
    }, 3000)
  }

  const refCode = stats?.refCode ?? ''
  const link = refCode ? `https://t.me/${effectiveBot}?startapp=${refCode}` : ''

  const handleCopy = async () => {
    if (!link) {
      return
    }
    tapFeedback('light')
    try {
      await navigator.clipboard.writeText(link)
      showToast('Ссылка скопирована')
    } catch {
      showToast('Не удалось скопировать ссылку', 'error')
    }
  }

  const handleShare = () => {
    if (!link) {
      return
    }
    tapFeedback('medium')

    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
      SHARE_TEXT,
    )}`
    const webApp = telegramWebApp()

    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(shareUrl)
      return
    }

    window.open(shareUrl, '_blank', 'noopener')
  }

  return (
    <section className="flex flex-col gap-3.5">
      <div>
        <h2 className="m-0 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white">
          <Users size={22} className="text-[#8A2BE2]" />
          Пригласи друга
        </h2>
        <p className="mb-0 mt-1 text-sm text-gray-400">
          Получай 10% от пополнений друзей, когда они их отыграют.
        </p>
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

      <div className="glass-card flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
          <UserPlus size={13} className="text-[#FFD700]" />
          Твоя ссылка
        </div>
        <div className="break-all rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-gray-300">
          {link || 'Загрузка ссылки…'}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="gold-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm"
            onClick={() => void handleCopy()}
            disabled={!link}
          >
            <Copy size={15} />
            Скопировать
          </button>
          <button
            type="button"
            className="ghost-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm"
            onClick={handleShare}
            disabled={!link}
          >
            <Share2 size={15} className="text-[#c084fc]" />
            Поделиться
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card flex flex-col items-center gap-1 px-3 py-4 text-center">
          <span className="inline-flex items-center gap-1 text-xl font-extrabold text-[#FFD700]">
            <Star size={16} fill="currentColor" />
            {stats?.totalEarned ?? 0}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Всего заработано
          </span>
        </div>
        <div className="glass-card flex flex-col items-center gap-1 px-3 py-4 text-center">
          <span className="text-xl font-extrabold text-white">{stats?.referredCount ?? 0}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Приглашено
          </span>
        </div>
      </div>

      <div className="glass-card flex flex-col gap-1.5 p-3.5">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
          <Check size={13} className="text-emerald-400" />
          Успешно приглашены
        </div>

        {loading && !stats ? (
          <div className="py-4 text-center text-sm text-gray-400">Загрузка…</div>
        ) : stats?.successfulInvites && stats.successfulInvites.length > 0 ? (
          stats.successfulInvites.map((friend) => (
            <div
              key={friend.id}
              className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-[13px] last:border-0"
            >
              <span className="min-w-0 truncate font-bold text-white">
                {friend.username?.trim()
                  ? `@${friend.username.trim().replace(/^@/, '')}`
                  : friend.firstName?.trim() || `Player #${friend.id}`}
              </span>
              <span className="shrink-0 text-[11px] text-gray-400">{formatDate(friend.createdAt)}</span>
            </div>
          ))
        ) : (
          <div className="py-4 text-center text-sm text-gray-400">Пока никого</div>
        )}
      </div>

      <div className="glass-card flex flex-col gap-1.5 p-3.5">
        <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
          История начислений
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] font-semibold text-red-300">
            {error}
          </div>
        )}

        {loading && !stats ? (
          <div className="py-4 text-center text-sm text-gray-400">Загрузка…</div>
        ) : (stats?.recentEarnings.length ?? 0) === 0 ? (
          <div className="py-4 text-center text-sm text-gray-400">Пока никого</div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0 p-0">
            {stats?.recentEarnings.map((earning) => (
              <li
                key={earning.id}
                className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-[13px] last:border-0"
              >
                <span className="inline-flex shrink-0 items-center gap-0.5 font-extrabold text-[#FFD700]">
                  +{earning.amount}
                  <Star size={12} fill="currentColor" />
                </span>
                <span className="min-w-0 truncate text-right text-[11px] text-gray-400">
                  от {personName(earning.referredId, earning.username, earning.firstName)} •{' '}
                  {relativeTime(earning.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
