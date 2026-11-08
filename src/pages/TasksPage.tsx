import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, Star, Target } from 'lucide-react'
import { ApiError, claimTask, getTasks } from '../api/client'
import type { TaskItem } from '../api/types'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'

interface TasksPageProps {
  balance: number
  onBalanceChange: (newBalance: number) => void
}

function openChannel(channelUsername?: string | null): void {
  const username = (channelUsername || 'NewsGiftRoll').replace(/^@/, '')
  openTelegramLink(`https://t.me/${encodeURIComponent(username)}`)
}

function openTelegramLink(url: string): void {
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

export default function TasksPage({ balance, onBalanceChange }: TasksPageProps) {
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
      onBalanceChange(result.newBalance)
      successFeedback()
      setNotice(`+${result.reward} ⭐ зачислено`)
      await loadTasks()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_CLAIMED') {
        await loadTasks()
      }
      const message =
        err instanceof ApiError && err.code === 'TASK_NOT_COMPLETED' && task.id === 'task-nickname'
          ? 'Не вижу GiftRoll в имени. Сохранил изменения?'
          : err instanceof ApiError
            ? err.message
            : 'Не удалось забрать награду'
      setError(message)
      errorFeedback()
    } finally {
      setBusyId(null)
    }
  }

  const handleCheck = async (taskId: string) => {
    tapFeedback('light')
    setBusyId(taskId)
    await loadTasks()
    setBusyId(null)
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
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-2xl">
                  {task.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 truncate text-[15px] font-extrabold text-white">{task.title}</h2>
                  <p className="mb-2 mt-1 text-xs leading-snug text-gray-400">{task.description}</p>
                  <div className="mb-2 flex items-center gap-1 text-xs font-extrabold text-[#FFD700]">
                    <Star size={12} fill="currentColor" /> +{task.reward} ⭐
                  </div>

                  {task.progressTarget !== undefined && !task.completed && (
                    <div className="mb-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#FFD700] to-[#FFA500] transition-[width] duration-300"
                          style={{ width: `${Math.min(100, ((task.progressCurrent ?? 0) / task.progressTarget) * 100)}%` }}
                        />
                      </div>
                      <p className="mb-0 mt-1 text-[10px] text-gray-500">
                        День {task.progressCurrent ?? 0}/{task.progressTarget}
                      </p>
                    </div>
                  )}

                  {task.maxCompletions !== null && task.maxCompletions !== undefined && (
                    <p className="mb-2 mt-0 text-[10px] text-gray-500">
                      Выполнили: {task.completedByCount ?? 0}/{task.maxCompletions}
                    </p>
                  )}

                  {task.claimed ? (
                    <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
                      <Check size={14} /> Получено
                    </button>
                  ) : !task.available ? (
                    <span className="inline-flex rounded-xl border border-gray-500/20 bg-white/[0.04] px-3 py-2 text-xs font-bold text-gray-500">
                      Лимит выполнений достигнут
                    </span>
                  ) : task.completed ? (
                    <button type="button" className="gold-btn px-3 py-2 text-xs" disabled={busy} onClick={() => void handleClaim(task)}>
                      {busy ? 'Зачисляем…' : `Забрать +${task.reward} ⭐`}
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="ghost-btn px-3 py-2 text-xs" disabled={busy} onClick={() => void handleCheck(task.id)}>
                        {busy ? 'Проверяем…' : 'Проверить'}
                      </button>
                      {task.type === 'channel_subscription' && (
                        <button type="button" className="ghost-btn px-3 py-2 text-xs" onClick={() => { tapFeedback('light'); openChannel(task.channelUsername) }}>
                          Подписаться
                        </button>
                      )}
                      {task.id === 'task-nickname' && (
                        <button type="button" className="ghost-btn px-3 py-2 text-xs" onClick={() => { tapFeedback('light'); openTelegramLink('https://t.me/settings/edit') }}>
                          Открыть настройки
                        </button>
                      )}
                    </div>
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
