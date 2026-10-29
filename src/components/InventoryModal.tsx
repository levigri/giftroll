import { useEffect, useState } from 'react'
import { Lock, Star, X } from 'lucide-react'
import type { InventoryItem } from '../api/types'
import { getInventory, sellNft } from '../api/client'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'
import { prizeImage } from '../utils/assets'
import AssetImage from './AssetImage'

export interface InventoryModalProps {
  onClose: () => void
  onBalanceChange: (newBalance: number) => void
  onCountChange: (newCount: number) => void
  /** 'modal' — оверлей поверх экрана, 'page' — содержимое вкладки «Инвентарь». */
  variant?: 'modal' | 'page'
}

export default function InventoryModal({
  onClose,
  onBalanceChange,
  onCountChange,
  variant = 'modal',
}: InventoryModalProps) {
  const isPage = variant === 'page'
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** Предмет, по которому ждём подтверждения продажи. */
  const [confirmItem, setConfirmItem] = useState<InventoryItem | null>(null)
  /** Сообщение о зачисленных звёздах после продажи. */
  const [notice, setNotice] = useState<string | null>(null)

  /** Выплата за продажу: 95% от номинала, тот же расчёт, что на сервере. */
  const sellPriceOf = (item: InventoryItem): number => Math.floor(item.prizePrice * 0.95)

  const showNotice = (msg: string) => {
    setNotice(msg)
    setTimeout(() => {
      setNotice((current) => (current === msg ? null : current))
    }, 3000)
  }

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => {
      setError((current) => (current === msg ? null : current))
    }, 3000)
  }

  const handleSellClick = (item: InventoryItem) => {
    tapFeedback('light')
    const lockTime = item.lockUntil ? new Date(item.lockUntil).getTime() : Number.NaN
    if (Number.isFinite(lockTime) && lockTime > Date.now()) {
      const daysLeft = Math.ceil((lockTime - Date.now()) / (1000 * 60 * 60 * 24))
      errorFeedback()
      showError(
        item.isExternal
          ? `Продажа заблокирована на ${daysLeft} дн. Внешние NFT удерживаются 21 день с момента получения.`
          : `Продажа заблокирована на ${daysLeft} дн. Для NFT, выигранных на Telegram Stars, действует правило удержания.`,
      )
      return
    }

    setConfirmItem(item)
  }

  const loadItems = async () => {
    try {
      setLoading(true)
      const res = await getInventory()
      setItems(res.items)
      onCountChange(res.items.length)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить инвентарь'
      showError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [])

  const handleSell = async (item: InventoryItem) => {
    tapFeedback('medium')
    setBusyId(item.id)
    setConfirmItem(null)

    // Убираем из сетки сразу — после подтверждения предмет продан.
    const previous = items
    const nextItems = items.filter((i) => i.id !== item.id)
    setItems(nextItems)
    onCountChange(nextItems.length)

    try {
      const res = await sellNft(item.id)
      successFeedback()
      onBalanceChange(res.newBalance)
      showNotice(`Продано за ${res.soldFor} ⭐ — звёзды зачислены на баланс`)
    } catch (err: unknown) {
      errorFeedback()
      // Продажа не прошла — возвращаем предмет на место.
      setItems(previous)
      onCountChange(previous.length)
      const message = err instanceof Error ? err.message : 'Ошибка при продаже предмета'
      showError(message)
    } finally {
      setBusyId(null)
    }
  }

  const content = (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-xl font-extrabold text-white">Инвентарь</h2>
        {!isPage && (
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-400">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Загрузка предметов...</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">У тебя пока нет NFT-подарков</div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {items.map((item) => {
            const sellPrice = sellPriceOf(item)
            const isBusy = busyId === item.id
            const lockTime = item.lockUntil ? new Date(item.lockUntil).getTime() : Number.NaN
            const daysLeft = Math.ceil((lockTime - Date.now()) / (1000 * 60 * 60 * 24))
            const isLocked = Number.isFinite(lockTime) && daysLeft > 0

            return (
              <div
                key={item.id}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-2.5 text-center backdrop-blur-md"
              >
                <AssetImage
                  src={prizeImage(item.prizeName, item.prizeEmoji)}
                  alt={item.prizeName}
                  className="h-14 w-14"
                  glow="rgba(138,43,226,0.5)"
                />
                <div className="w-full truncate text-[11px] font-bold text-white">{item.prizeName}</div>
                <div className="text-[11px] font-bold text-[#FFD700]">{item.prizePrice}</div>
                {item.status !== 'CLAIMED' && (
                  <>
                    {isLocked && (
                      <span className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-red-400/25 bg-red-500/10 px-1 py-1.5 text-[10px] font-bold text-red-400">
                        <Lock size={11} /> Через {daysLeft} дн.
                      </span>
                    )}
                    <button
                      type="button"
                      className="gold-btn w-full py-1.5 text-[10px]"
                      disabled={isBusy}
                      onClick={() => handleSellClick(item)}
                    >
                      {isBusy ? '...' : 'Продать'}
                    </button>
                  </>
                )}
                {item.status !== 'PENDING' && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-gray-500">
                    {sellPrice}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirmItem && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Подтверждение продажи"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setConfirmItem(null)}
            aria-label="Отмена"
          />

          <div className="relative w-full max-w-[320px] rounded-2xl border border-white/10 bg-[#0B0C10] p-4 text-center">
            <AssetImage
              src={prizeImage(confirmItem.prizeName, confirmItem.prizeEmoji)}
              alt={confirmItem.prizeName}
              className="mx-auto h-16 w-16"
              glow="rgba(138,43,226,0.5)"
            />
            <div className="mt-2 w-full truncate text-sm font-bold text-white">
              {confirmItem.prizeName}
            </div>
            <p className="mt-3 text-xs text-gray-400">Точно продать? Получишь</p>
            <div className="mt-1 inline-flex items-center gap-1 text-2xl font-extrabold text-[#FFD700]">
              {sellPriceOf(confirmItem)}
              <Star size={18} fill="currentColor" />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-bold text-gray-300 transition hover:bg-white/10"
                onClick={() => setConfirmItem(null)}
              >
                Нет
              </button>
              <button
                type="button"
                className="gold-btn flex-1 py-2.5 text-sm"
                disabled={busyId === confirmItem.id}
                onClick={() => void handleSell(confirmItem)}
              >
                {busyId === confirmItem.id ? '...' : 'Да'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (isPage) {
    return (
      <div aria-label="Инвентарь">{content}</div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Инвентарь">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Закрыть" />
      <div className="relative max-h-[80vh] w-full max-w-[400px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0B0C10] p-4">
        {content}
      </div>
    </div>
  )
}
