import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, CalendarDays, Coins, LoaderCircle, Package, Search, Shield } from 'lucide-react'
import {
  adminGetRecentTransactions,
  adminGetUser,
  adminSearchUsers,
  ApiError,
} from '../api/client'
import type { AdminTransaction, AdminUserDetails, AdminUserSummary } from '../api/types'

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
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserDetails | null>(null)
  const [recentTransactions, setRecentTransactions] = useState<AdminTransaction[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingUser, setLoadingUser] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchSequence = useRef(0)

  useEffect(() => {
    let active = true
    void adminGetRecentTransactions()
      .then((items) => {
        if (active) setRecentTransactions(items)
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить последние операции')
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

      {!selectedUser && (
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

      {loadingUser && (
        <div className="glass-card flex items-center justify-center gap-2 p-6 text-sm text-gray-400">
          <LoaderCircle size={18} className="animate-spin" /> Загружаю профиль…
        </div>
      )}

      {!selectedUser && query.trim() && !searching && (
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

      {selectedUser && !loadingUser && (
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

      {!selectedUser && !query.trim() && (
        <section className="glass-card p-4">
          <h2 className="mb-2 mt-0 text-base font-extrabold text-white">Последние операции</h2>
          {recentTransactions.length === 0 ? <p className="m-0 text-sm text-gray-500">Операций пока нет</p> : (
            <ul className="m-0 list-none p-0">{recentTransactions.map(renderTransaction)}</ul>
          )}
        </section>
      )}
    </section>
  )
}
