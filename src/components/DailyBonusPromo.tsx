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
 * Картинка лежит на белом фоне, поэтому она посажена в белую рамку с закруглением —
 * так белое поле превращается в намеренный дизайн-элемент, а не в «белый квадрат»
 * на тёмной теме. `mix-blend-mode: screen` не помогает (screen(белый, что угодно) = белый),
 * а `multiply` на тёмной карточке (#18181b) почти вычеркнул бы саму коробку:
 * цвет пикселя умножается на ~0.09. На белой подложке multiply даёт тот же результат,
 * что и отсутствие смешивания, поэтому выбрана белая рамка.
 */
export default function DailyBonusPromo({ onClose, onStart }: DailyBonusPromoProps) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Бесплатный кейс готов"
    >
      <div className="w-full max-w-[340px] bg-[#18181b] border border-[#8A2BE2]/40 rounded-[32px] p-6 flex flex-col items-center relative shadow-[0_0_50px_rgba(138,43,226,0.4)] overflow-hidden">
        <button
          type="button"
          aria-label="Закрыть"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-gray-300 transition hover:bg-white/10 hover:text-white"
          onClick={() => {
            tapFeedback('light')
            onClose()
          }}
        >
          <X size={16} />
        </button>

        {/* Белая «рамка-бейдж» вокруг картинки с белым фоном. */}
        <div className="mb-4 rounded-2xl bg-white p-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          {imageFailed ? (
            <span className="flex h-56 w-56 items-center justify-center rounded-xl bg-[#0B0C10]">
              <Gift size={88} className="text-[#FFD700]" />
            </span>
          ) : (
            <img
              src="/promo.png"
              alt="Free Case"
              className="w-56 h-56 object-contain"
              onError={() => setImageFailed(true)}
            />
          )}
        </div>

        <h2 className="text-2xl font-black text-white text-center mb-1">
          Твой бесплатный кейс готов!
        </h2>
        <p className="text-gray-400 text-sm text-center mb-6">
          Забери свой бонус, который ждет тебя каждые 24 часа.
        </p>

        <button
          type="button"
          className="w-full py-3.5 bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-black font-extrabold text-lg rounded-xl shadow-[0_0_20px_rgba(255,215,0,0.4)] active:scale-95 transition-transform"
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
