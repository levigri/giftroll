import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, Star, Target } from 'lucide-react'
import { ApiError, claimTask, getTasks } from '../api/client'
import type { TaskItem } from '../api/types'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'

interface TasksPageProps {
  balance: number
  onBalanceChange: (newBalance: number) => void
  onRefreshMe?: () => Promise<void> | void
}

function openChannel(): void {
  const url = 'https://t.me/NewsGiftRoll'
  const webApp = (
    window as unknown as {
      Telegram?: { WebApp?: { openTelegramLink?: (link: string) => void } }
    }
  ).Telegram?.WebApp

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export default function TasksPage({ balance, onBalanceChange, onRefreshMe }: TasksPageProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      setError(null)
      const response = await getTasks()
      setTasks(response.tasks)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Не удалось загрузить задания'
      setError(message)
      errorFeedback()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()

    const onFocus = () => void loadTasks()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadTasks()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadTasks])

  const handleClaim = async (task: TaskItem) => {
    tapFeedback('medium')
    setBusyId(task.id)
    setError(null)
    setNotice(null)
    try {
      const result = await claimTask(task.id)
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: true, claimed: true } : item))
      onBalanceChange(result.newBalance)
      await onRefreshMe?.()
      successFeedback()
      setNotice(`+${result.reward} ⭐ зачислено`)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Не удалось забрать награду'
      setError(message)
      errorFeedback()
      if (err instanceof ApiError && err.code === 'ALREADY_CLAIMED') {
        await loadTasks()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-4 pb-3">
      <header className="flex items-center justify-between gap-3 px-1 pt-1">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">GiftRoll</p>
          <h1 className="m-0 flex items-center gap-2 text-2xl font-extrabold text-white">
            <Target size={23} className="text-[#FFD700]" /> Задания
          </h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[#FFD700]/20 bg-[#FFD700]/[0.07] px-3 py-2 text-sm font-extrabold text-white">
          <Star size={15} className="text-[#FFD700]" fill="currentColor" />
          {balance.toLocaleString('ru-RU')}
        </div>
      </header>

      {notice && (
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-2.5 text-sm font-bold text-emerald-300" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-3.5 py-2.5 text-sm font-semibold text-red-300" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-card flex items-center justify-center gap-2 p-8 text-sm font-semibold text-gray-400">
          <LoaderCircle size={17} className="animate-spin" /> Загружаем задания…
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass-card p-5 text-center text-sm text-gray-400">Заданий пока нет</div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => {
            const busy = busyId === task.id
            return (
              <article key={task.id} className="glass-card flex items-center gap-3 p-3.5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[27px]">
                  {task.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 truncate text-[15px] font-extrabold text-white">{task.title}</h2>
                  <p className="mb-2 mt-1 text-xs leading-snug text-gray-400">{task.description}</p>
                  <div className="mb-2 flex items-center gap-1 text-xs font-extrabold text-[#FFD700]">
                    <Star size={13} fill="currentColor" /> +{task.reward} ⭐
                  </div>

                  {task.claimed ? (
                    <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
                      <Check size={14} /> Получено
                    </span>
                  ) : task.completed ? (
                    <button type="button" className="gold-btn px-3 py-2 text-xs" disabled={busy} onClick={() => void handleClaim(task)}>
                      {busy ? 'Зачисляем…' : `Забрать +${task.reward} ⭐`}
                    </button>
                  ) : task.id === 'task-channel' ? (
                    <button
                      type="button"
                      className="ghost-btn px-3 py-2 text-xs"
                      onClick={() => { tapFeedback('light'); openChannel() }}
                    >
                      Подписаться
                    </button>
                  ) : (
                    <span className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-gray-500">
                      {task.id === 'task-first-case' ? 'Открой любой кейс' : 'Добавь GiftRoll в имя'}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
