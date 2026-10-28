import { useEffect, useRef } from 'react'
import { Bot, Sparkles, Star, Trophy, User } from 'lucide-react'

/** Победитель раунда в том виде, в каком его отдаёт лобби. */
export interface WinnerOverlayWinner {
  /**
   * id участника. Сервер присылает его строкой (BigInt не проходит через JSON),
   * поэтому принимаем и string, и number/bigint.
   */
  userId: bigint | number | string
  username: string
  stars: number
  isBot: boolean
}

export interface WinnerOverlayProps {
  winner: WinnerOverlayWinner
  /** Весь банк раунда — сумма ставок всех участников. */
  totalStars: number
  /** Мой id: по нему понимаем, выиграл я или проиграл. */
  myUserId: bigint | number | string
  /** Моя выплата (0, если победил не я). */
  myPayout: number
  /** Моя ставка в этом раунде. */
  myBet: number
  /** Закрыть оверлей: кнопка «Играть ещё» или авто-закрытие. */
  onClose: () => void
}

/** Оверлей закрывается сам через 5 секунд. */
export const WINNER_OVERLAY_AUTO_CLOSE_MS = 5000

/**
 * Полноэкранный оверлей победителя раунда. Рисуется ПОВЕРХ колеса — само колесо
 * остаётся на экране и уже показывает выпавший сектор.
 */
export default function WinnerOverlay({
  winner,
  totalStars,
  myUserId,
  myPayout,
  myBet,
  onClose,
}: WinnerOverlayProps) {
  // Свежий колбэк без пересоздания таймера: перезапуск эффекта сбросил бы отсчёт.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Авто-закрытие через 5 секунд; таймер снимается при размонтировании.
  useEffect(() => {
    const timer = window.setTimeout(() => onCloseRef.current(), WINNER_OVERLAY_AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const iWon = String(winner.userId) === String(myUserId)
  // Бот — виртуальный игрок: у него нет ника, показываем нейтральное имя.
  const displayName = winner.isBot ? 'Test Bot' : winner.username || 'Игрок'
  // Выплата включает мою ставку, поэтому в итоге показываем чистую прибыль.
  const netProfit = myPayout - myBet

  return (
    <div className="winner-overlay" role="dialog" aria-modal="true" aria-label="Победитель раунда">
      <div className="winner-overlay__backdrop" onClick={() => onCloseRef.current()} />

      <div className="winner-overlay__card">
        <div
          className={`winner-overlay__avatar ${winner.isBot ? 'winner-overlay__avatar--bot' : ''}`}
        >
          {winner.isBot ? <Bot size={36} /> : <User size={36} />}
        </div>

        <div className="winner-overlay__title inline-flex items-center justify-center gap-2">
          <Trophy size={20} className="text-[#FFD700]" />
          {displayName}
        </div>
        <div className="winner-overlay__amount inline-flex items-center justify-center gap-1">
          выиграл {totalStars}
          <Star size={15} fill="currentColor" />
        </div>

        <div className="winner-overlay__divider" />

        <div
          className={`winner-overlay__result ${
            iWon ? 'winner-overlay__result--win' : 'winner-overlay__result--lose'
          }`}
        >
          {iWon ? (
            <span className="inline-flex items-center justify-center gap-1">
              <Sparkles size={16} />
              Ты выиграл +{netProfit}
              <Star size={14} fill="currentColor" />
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-1">
              Ты проиграл −{myBet}
              <Star size={14} fill="currentColor" />
            </span>
          )}
        </div>

        <button
          type="button"
          className="gold-btn winner-overlay__btn py-3.5 text-base"
          onClick={() => onCloseRef.current()}
        >
          Играть ещё
        </button>
      </div>
    </div>
  )
}
