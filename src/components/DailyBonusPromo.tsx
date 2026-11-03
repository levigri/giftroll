import { useState } from 'react'
import { Gift, X } from 'lucide-react'
import { tapFeedback } from '../telegram'

export interface DailyBonusPromoProps {
  onClose: () => void
  /** Кнопка «Забрать кейс»: закрывает промо, уводит на вкладку «Игры» и открывает модалку бесплатного кейса. */
  onStart: () => void
}

/**
 * Промо-модалка «Твой бесплатный кейс готов!»: 3D-картинка с коробкой «free»,
 * поясняющий текст и золотая кнопка-CTA.
 *
 * Фон у картинки уже вырезан (в `public/promo.png` — PNG с альфа-каналом), поэтому
 * она ложится прямо на тёмную карточку: ни белой рамки, ни `mix-blend-mode` не нужно.
 * Смешивание здесь и вредно: `screen` оставляет светлое поле нетронутым,
 * а `multiply` на #18181b умножает цвета коробки на ~0.09 и практически её стирает.
 */
export default function DailyBonusPromo({ onClose, onStart }: DailyBonusPromoProps) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Бесплатный кейс готов"
    >
      <div className="relative flex w-full max-w-[340px] flex-col items-center overflow-hidden rounded-[32px] border border-white/10 bg-[#18181b] p-5 shadow-none">
        <button
          type="button"
          aria-label="Закрыть"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/40 text-gray-300 transition hover:bg-white/10 hover:text-white"
          onClick={() => {
            tapFeedback('light')
            onClose()
          }}
        >
          <X size={16} />
        </button>

        {/* Картинка без подложки: фон в самом файле прозрачный. */}
        {imageFailed ? (
          <span className="mx-auto mb-3 flex h-36 w-36 items-center justify-center rounded-2xl bg-white/5">
            <Gift size={72} className="text-[#FFD700]" />
          </span>
        ) : (
          <img
            src="/promo.png"
            alt="Free Case"
            className="mx-auto mb-3 h-36 w-36 object-contain"
            onError={() => setImageFailed(true)}
          />
        )}

        <h2 className="mb-1 text-center text-xl font-black leading-tight text-white">
          Твой бесплатный кейс готов!
        </h2>
        <p className="mb-5 text-center text-xs text-gray-400">
          Забери свой бонус, который ждет тебя каждые 24 часа.
        </p>

        <button
          type="button"
          className="w-full py-3 bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-black font-extrabold text-base rounded-xl shadow-none active:scale-95 transition-transform"
          onClick={() => {
            tapFeedback('medium')
            onClose()
            onStart()
          }}
        >
          Забрать кейс
        </button>
      </div>
    </div>
  )
}
