import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Activity, ArrowLeft, CalendarDays, Coins, LoaderCircle, Package, Plus, Save, Search, Shield } from 'lucide-react'
import {
  adminCreateChannelTask,
  adminGetHistory,
  adminGetRecentTransactions,
  adminGetTasks,
  adminGetUser,
  adminSearchUsers,
  adminUpdateTask,
  ApiError,
} from '../api/client'
import type { AdminActivity, AdminTask, AdminTransaction, AdminUserDetails, AdminUserSummary } from '../api/types'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayName(user: Pick<AdminUserSummary, 'username' | 'firstName'>): string {
  return user.username ? `@${user.username}` : user.firstName
}

function amountClass(amount: number): string {
  return amount >= 0 ? 'text-emerald-300' : 'text-rose-300'
}

export default function AdminPage() {
  const [section, setSection] = useState<'players' | 'history' | 'tasks'>('players')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserDetails | null>(null)
  const [recentTransactions, setRecentTransactions] = useState<AdminTransaction[]>([])
  const [history, setHistory] = useState<AdminActivity[]>([])
  const [managedTasks, setManagedTasks] = useState<AdminTask[]>([])
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, string>>({})
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({})
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const [newChannel, setNewChannel] = useState('')
  const [newReward, setNewReward] = useState('5')
  const [newLimit, setNewLimit] = useState('100')
  const [searching, setSearching] = useState(false)
  const [loadingUser, setLoadingUser] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchSequence = useRef(0)

  useEffect(() => {
    let active = true
    void Promise.all([adminGetRecentTransactions(), adminGetHistory(), adminGetTasks()])
      .then(([items, activity, tasks]) => {
        if (!active) return
        setRecentTransactions(items)
        setHistory(activity)
        setManagedTasks(tasks)
        setRewardDrafts(Object.fromEntries(tasks.map((task) => [task.id, String(task.reward)])))
        setLimitDrafts(Object.fromEntries(tasks.map((task) => [task.id, task.maxCompletions == null ? '' : String(task.maxCompletions)])))
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить данные админ-панели')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const value = query.trim()
    const sequence = ++searchSequence.current
    if (!value) {
      setUsers([])
      setSearching(false)
      return
    }

    setSearching(true)
    const timer = window.setTimeout(() => {
      void adminSearchUsers(value)
        .then((items) => {
          if (sequence === searchSequence.current) {
            setUsers(items)
            setError(null)
          }
        })
        .catch((err: unknown) => {
          if (sequence === searchSequence.current) {
            setError(err instanceof ApiError ? err.message : 'Не удалось найти пользователей')
            setUsers([])
          }
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      searchSequence.current += 1
    }
  }, [query])

  const selectUser = async (user: AdminUserSummary) => {
    setLoadingUser(true)
    setError(null)
    try {
      setSelectedUser(await adminGetUser(user.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось открыть профиль игрока')
    } finally {
      setLoadingUser(false)
    }
  }

  const changeSection = (next: 'players' | 'history' | 'tasks') => {
    setSection(next)
    setSelectedUser(null)
    setQuery('')
    setError(null)
  }

  const saveTask = async (task: AdminTask) => {
    const reward = Number(rewardDrafts[task.id])
    const rawLimit = limitDrafts[task.id]?.trim() ?? ''
    const maxCompletions = rawLimit ? Number(rawLimit) : null
    if (!Number.isInteger(reward) || reward < 1 || (maxCompletions !== null && (!Number.isInteger(maxCompletions) || maxCompletions < 1))) {
      setError('Награда и лимит должны быть положительными целыми числами')
      return
    }

    setSavingTaskId(task.id)
    setError(null)
    setTaskNotice(null)
    try {
      const updated = await adminUpdateTask(task.id, { reward, maxCompletions })
      setManagedTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
      setTaskNotice(`Сохранено: ${updated.title}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить задание')
    } finally {
      setSavingTaskId(null)
    }
  }

  const toggleTask = async (task: AdminTask) => {
    setSavingTaskId(task.id)
    setError(null)
    setTaskNotice(null)
    try {
      const updated = await adminUpdateTask(task.id, { active: !task.active })
      setManagedTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
      setTaskNotice(updated.active ? `Задание «${updated.title}» опубликовано` : `Задание «${updated.title}» скрыто`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось изменить публикацию задания')
    } finally {
      setSavingTaskId(null)
    }
  }

  const createSubscriptionTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const reward = Number(newReward)
    const maxCompletions = Number(newLimit)
    if (!newChannel.trim() || !Number.isInteger(reward) || reward < 1 || !Number.isInteger(maxCompletions) || maxCompletions < 1) {
      setError('Укажи канал, целую награду и лимит выполнений')
      return
    }

    setSavingTaskId('new')
    setError(null)
    setTaskNotice(null)
    try {
      const created = await adminCreateChannelTask({
        channelUsername: newChannel.trim(),
        reward,
        maxCompletions,
      })
      setManagedTasks((current) => [...current, created])
      setRewardDrafts((current) => ({ ...current, [created.id]: String(created.reward) }))
      setLimitDrafts((current) => ({ ...current, [created.id]: String(created.maxCompletions ?? '') }))
      setNewChannel('')
      setTaskNotice(`Задание «${created.title}» опубликовано`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать задание')
    } finally {
      setSavingTaskId(null)
    }
  }

  const renderTransaction = (transaction: AdminTransaction) => (
    <li key={transaction.id} className="flex items-start justify-between gap-3 border-b border-white/5 py-3 last:border-0">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-bold text-white">
          {displayName(transaction)} <span className="font-medium text-gray-500">· {transaction.type}</span>
        </p>
        <p className="mb-0 mt-1 line-clamp-2 text-xs text-gray-400">{transaction.details || 'Без описания'}</p>
        <p className="mb-0 mt-1 text-[11px] text-gray-600">ID {transaction.userId} · {formatDate(transaction.createdAt)}</p>
      </div>
      <span className={`shrink-0 text-sm font-extrabold ${amountClass(transaction.amount)}`}>
        {transaction.amount > 0 ? '+' : ''}{transaction.amount} ⭐
      </span>
    </li>
  )

  return (
    <section className="flex flex-col gap-4 pb-4">
      <header className="flex items-center gap-3 px-1 pt-1">
        {selectedUser ? (
          <button
            type="button"
            onClick={() => setSelectedUser(null)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Назад к поиску"
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/20 bg-amber-400/10 text-amber-300">
            <Shield size={19} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="m-0 truncate text-xl font-extrabold text-white">Админ-панель</h1>
          <p className="m-0 mt-0.5 text-xs text-gray-500">Управление игроками и операциями</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
        {([
          ['players', 'Игроки'],
          ['history', 'История'],
          ['tasks', 'Задания'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => changeSection(id)}
            className={`rounded-xl px-2 py-2.5 text-xs font-extrabold transition ${
              section === id ? 'bg-white/10 text-amber-300' : 'text-gray-500 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'players' && !selectedUser && (
        <div className="glass-card flex items-center gap-3 p-3">
          <Search size={18} className="shrink-0 text-gray-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Telegram ID или username"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
            autoComplete="off"
            inputMode="search"
          />
          {searching && <LoaderCircle size={17} className="animate-spin text-amber-300" />}
        </div>
      )}

      {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

      {section === 'players' && loadingUser && (
        <div className="glass-card flex items-center justify-center gap-2 p-6 text-sm text-gray-400">
          <LoaderCircle size={18} className="animate-spin" /> Загружаю профиль…
        </div>
      )}

      {section === 'players' && !selectedUser && query.trim() && !searching && (
        <section className="glass-card p-3">
          <h2 className="mb-2 mt-0 text-sm font-extrabold text-gray-300">Результаты поиска</h2>
          {users.length === 0 ? (
            <p className="m-0 py-3 text-center text-sm text-gray-500">Игроки не найдены</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-white/5 p-0">
              {users.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => void selectUser(user)}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold text-white">{displayName(user)}</span>
                      <span className="mt-1 block text-xs text-gray-500">ID {user.id} · {formatDate(user.createdAt)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-extrabold text-amber-300">{user.balance} ⭐</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'players' && selectedUser && !loadingUser && (
        <>
          <section className="glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {selectedUser.user.photoUrl ? (
                  <img src={selectedUser.user.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-extrabold text-gray-300">
                    {selectedUser.user.firstName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-lg font-extrabold text-white">
                    {selectedUser.user.firstName} {selectedUser.user.lastName || ''}
                  </h2>
                  <p className="m-0 mt-0.5 truncate text-sm text-gray-400">
                    {selectedUser.user.username ? `@${selectedUser.user.username}` : 'Без username'} · ID {selectedUser.user.id}
                  </p>
                </div>
              </div>
              {selectedUser.user.isBetaMode && <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-bold text-violet-300">БЕТА</span>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.04] p-3">
                <p className="m-0 text-xs text-gray-500">Баланс</p>
                <p className="m-0 mt-1 text-lg font-extrabold text-amber-300">{selectedUser.user.balance} ⭐</p>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-3">
                <p className="m-0 text-xs text-gray-500">Регистрация</p>
                <p className="m-0 mt-1 text-xs font-bold text-white">{formatDate(selectedUser.user.createdAt)}</p>
              </div>
              <div className="col-span-2 rounded-xl bg-white/[0.04] p-3">
                <p className="m-0 text-xs text-gray-500">Реферальный код · пригласил</p>
                <p className="m-0 mt-1 break-all text-sm font-bold text-white">{selectedUser.user.refCode} · {selectedUser.user.referredBy ?? 'нет'}</p>
              </div>
            </div>
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-3 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Coins size={17} className="text-amber-300" />Депозиты ({selectedUser.deposits.length})</h2>
            {selectedUser.deposits.length === 0 ? <p className="m-0 text-sm text-gray-500">Пополнений нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {selectedUser.deposits.map((deposit) => (
                  <li key={deposit.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-white">{deposit.amount} ⭐ · {deposit.currency}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${deposit.status === 'completed' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/10 text-gray-300'}`}>{deposit.status}</span>
                    </div>
                    <p className="mb-0 mt-1 text-xs text-gray-500">{formatDate(deposit.createdAt)}{deposit.gramsAmount !== null ? ` · ${deposit.gramsAmount} TON` : ''}</p>
                    {deposit.txHash && <p className="mb-0 mt-1 break-all text-[10px] text-gray-600">TX: {deposit.txHash}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-2 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Activity size={17} className="text-sky-300" />Транзакции ({selectedUser.transactions.length})</h2>
            {selectedUser.transactions.length === 0 ? <p className="m-0 text-sm text-gray-500">Операций нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {selectedUser.transactions.map((transaction) => (
                  <li key={transaction.id} className="flex items-start justify-between gap-3 py-3 last:pb-0">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-bold text-white">{transaction.type}</p>
                      <p className="mb-0 mt-1 text-xs text-gray-400">{transaction.details || 'Без описания'}</p>
                      <p className="mb-0 mt-1 text-[11px] text-gray-600">{formatDate(transaction.createdAt)}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-extrabold ${amountClass(transaction.amount)}`}>{transaction.amount > 0 ? '+' : ''}{transaction.amount} ⭐</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-3 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Package size={17} className="text-amber-300" />Открытия кейсов ({selectedUser.caseOpens.length})</h2>
            {selectedUser.caseOpens.length === 0 ? <p className="m-0 text-sm text-gray-500">Открытий кейсов нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {selectedUser.caseOpens.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-xl">{entry.prizeEmoji || '🎁'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold text-white">
                        {entry.isBetaMode ? 'ТЕСТ · ' : 'КЕЙС ОТКРЫТ · ВЫИГРЫШ · '}
                        {entry.prizeType === 'BALANCE' ? `+${entry.prizePrice} ⭐` : entry.prizeName}
                      </span>
                      <span className="mt-1 block truncate text-xs text-gray-400">Кейс «{entry.caseName}» · {entry.prizeType}{entry.isBetaMode ? ' · не начислено' : ''}</span>
                      <span className="mt-1 block text-[11px] text-gray-600">{formatDate(entry.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-3 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Activity size={17} className="text-violet-300" />Апгрейдер ({selectedUser.upgraderAttempts.length})</h2>
            {selectedUser.upgraderAttempts.length === 0 ? <p className="m-0 text-sm text-gray-500">Попыток апгрейда нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {selectedUser.upgraderAttempts.map((attempt) => (
                  <li key={attempt.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-sm font-extrabold text-white">
                          {attempt.targetNftEmoji} {attempt.targetNftName}
                          <span className="ml-2 text-xs font-bold text-gray-500">{attempt.chance.toFixed(2)}%</span>
                        </p>
                        <p className="mb-0 mt-1 text-xs text-gray-400">
                          Ставка {attempt.betAmount} ⭐ · цель {attempt.targetNftPrice} ⭐
                        </p>
                        <p className="mb-0 mt-1 text-[11px] text-gray-600">{formatDate(attempt.createdAt)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold ${attempt.win ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
                        {attempt.win ? (attempt.isBetaMode ? 'БЕТА · ПОБЕДА' : 'ПОБЕДА') : 'ПРОИГРЫШ'}
                      </span>
                    </div>
                    <p className="mb-0 mt-2 text-xs text-gray-300">
                      {attempt.win
                        ? attempt.isBetaMode
                          ? `Тестовый результат: выпал бы NFT «${attempt.targetNftName}» (${attempt.targetNftPrice} ⭐), расчётная выплата ${attempt.winAmount} ⭐.`
                          : `Выигран NFT «${attempt.targetNftName}» (${attempt.targetNftPrice} ⭐), выплата ${attempt.winAmount} ⭐.`
                          : `АПГРЕЙД ПРОИГРАН · NFT не выпал, ставка ${attempt.betAmount} ⭐ сгорела.`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-3 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Package size={17} className="text-violet-300" />Инвентарь ({selectedUser.inventory.length})</h2>
            {selectedUser.inventory.length === 0 ? <p className="m-0 text-sm text-gray-500">Предметов нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {selectedUser.inventory.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-xl">{item.prizeEmoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">{item.prizeName}</span>
                      <span className="mt-1 block text-xs text-gray-500"><CalendarDays size={12} className="mr-1 inline" />{formatDate(item.createdAt)} · {item.status}</span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-amber-300">{item.prizePrice} ⭐</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {section === 'history' && (
        <>
          <section className="glass-card p-4">
            <h2 className="mb-2 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Activity size={17} className="text-violet-300" />История кейсов и апгрейдера</h2>
            {history.length === 0 ? <p className="m-0 text-sm text-gray-500">Результатов пока нет</p> : (
              <ul className="m-0 list-none divide-y divide-white/5 p-0">
                {history.map((item) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-extrabold text-white">
                          {item.username ? `@${item.username}` : item.firstName} <span className="font-semibold text-gray-400">· ID {item.userId}</span>
                        </p>
                        <p className="mb-0 mt-1 text-xs text-gray-400">{item.title}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold ${item.isBetaMode ? 'bg-violet-400/10 text-violet-300' : item.won ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
                        {item.isBetaMode ? 'БЕТА · ТЕСТ' : item.won ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ'}
                      </span>
                    </div>
                    <p className={`mb-0 mt-2 text-sm font-bold ${item.isBetaMode ? 'text-violet-200' : item.won ? 'text-emerald-200' : 'text-rose-200'}`}>
                      {item.result}
                    </p>
                    <p className="mb-0 mt-1 text-[11px] text-gray-600">{formatDate(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-card p-4">
            <h2 className="mb-2 mt-0 text-base font-extrabold text-white">Последние транзакции</h2>
            {recentTransactions.length === 0 ? <p className="m-0 text-sm text-gray-500">Операций пока нет</p> : (
              <ul className="m-0 list-none p-0">{recentTransactions.map(renderTransaction)}</ul>
            )}
          </section>
        </>
      )}

      {section === 'tasks' && (
        <>
          <section className="glass-card p-4">
            <h2 className="mb-1 mt-0 flex items-center gap-2 text-base font-extrabold text-white"><Plus size={17} className="text-emerald-300" />Новое задание на подписку</h2>
            <p className="mb-3 mt-0 text-xs text-gray-500">Бот должен быть администратором канала, чтобы проверять подписку.</p>
            <form className="flex flex-col gap-3" onSubmit={(event) => void createSubscriptionTask(event)}>
              <label className="flex flex-col gap-1 text-xs font-bold text-gray-400">
                Канал
                <input value={newChannel} onChange={(event) => setNewChannel(event.target.value)} placeholder="@channel" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-bold text-gray-400">
                  Награда, ⭐
                  <input type="number" min="1" step="1" value={newReward} onChange={(event) => setNewReward(event.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-gray-400">
                  Лимит игроков
                  <input type="number" min="1" step="1" value={newLimit} onChange={(event) => setNewLimit(event.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none" />
                </label>
              </div>
              <button type="submit" disabled={savingTaskId === 'new'} className="gold-btn flex items-center justify-center gap-2 py-3 text-sm">
                {savingTaskId === 'new' ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
                Опубликовать задание
              </button>
            </form>
          </section>

          {taskNotice && <div role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-bold text-emerald-300">{taskNotice}</div>}

          <section className="flex flex-col gap-3">
            <h2 className="m-0 px-1 text-base font-extrabold text-white">Существующие задания</h2>
            {managedTasks.map((task) => (
              <article key={task.id} className="glass-card p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="m-0 text-sm font-extrabold text-white">{task.emoji} {task.title}</h3>
                    <p className="mb-0 mt-1 text-xs text-gray-500">{task.description}</p>
                    {task.channelUsername && <p className="mb-0 mt-1 text-[11px] text-sky-300">@{task.channelUsername.replace(/^@/, '')}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${task.active ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/10 text-gray-500'}`}>
                    {task.active ? 'Опубликовано' : 'Выключено'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] font-bold text-gray-500">
                    Награда, ⭐
                    <input type="number" min="1" step="1" value={rewardDrafts[task.id] ?? String(task.reward)} onChange={(event) => setRewardDrafts((current) => ({ ...current, [task.id]: event.target.value }))} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-bold text-gray-500">
                    Лимит (пусто — без лимита)
                    <input type="number" min="1" step="1" value={limitDrafts[task.id] ?? ''} onChange={(event) => setLimitDrafts((current) => ({ ...current, [task.id]: event.target.value }))} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" />
                  </label>
                </div>
                {task.maxCompletions !== null && <p className="mb-0 mt-2 text-[11px] text-gray-500">Выполнено: {task.completedByCount}/{task.maxCompletions}</p>}
                <button type="button" disabled={savingTaskId === task.id} onClick={() => void saveTask(task)} className="ghost-btn mt-3 flex w-full items-center justify-center gap-2 py-2.5 text-xs font-extrabold">
                  {savingTaskId === task.id ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
                  Сохранить награду и лимит
                </button>
                <button type="button" disabled={savingTaskId === task.id} onClick={() => void toggleTask(task)} className="ghost-btn mt-2 flex w-full items-center justify-center gap-2 py-2.5 text-xs font-extrabold">
                  {task.active ? 'Снять с публикации' : 'Опубликовать задание'}
                </button>
              </article>
            ))}
          </section>
        </>
      )}

    </section>
  )
}
