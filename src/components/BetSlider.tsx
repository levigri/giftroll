import { useEffect, useState } from 'react'
import { Pencil, Star } from 'lucide-react'

export interface BetSliderProps {
  /** Текущая ставка в ⭐. */
  value: number
  onChange: (stars: number) => void
  /** Подпись над значением («Ставка» / «Докинуть»). */
  label?: string
  balance?: number
  /**
   * Верхняя граница слайдера. По умолчанию MAX_BET_STARS, но не выше баланса —
   * иначе можно выставить ставку, которую всё равно нельзя подтвердить.
   */
  max?: number
  disabled?: boolean
  /** Компактный режим — для формы докида. */
  compact?: boolean
}

/** Допустимая ставка в звёздах (совпадает с серверной валидацией). */
export const MIN_BET_STARS = 10
export const MAX_BET_STARS = 100000
export const BET_STEP = 10

/** Свои коэффициенты быстрых кнопок запоминаем между сессиями. */
const QUICK_MULTIPLIERS_KEY = 'bet_quick_multipliers'
const DEFAULT_MULTIPLIERS: [number, number] = [2, 0.5]
const MIN_MULTIPLIER = 0.1
const MAX_MULTIPLIER = 20

function clampMultiplier(value: number): number {
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, Math.round(value * 10) / 10))
}

function loadMultipliers(): [number, number] {
  try {
    const raw = localStorage.getItem(QUICK_MULTIPLIERS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    ) {
      return [clampMultiplier(parsed[0]), clampMultiplier(parsed[1])]
    }
  } catch {
    // Нечитаемый localStorage — работаем со значениями по умолчанию.
  }
  return DEFAULT_MULTIPLIERS
}

/** 0.5 → «½», остальное → «×2», «×1.5». */
function labelOfMultiplier(multiplier: number): string {
  return multiplier === 0.5 ? '½' : `×${multiplier}`
}

export default function BetSlider({
  value,
  onChange,
  label = 'Ставка',
  balance,
  max,
  disabled = false,
  compact = false,
}: BetSliderProps) {
  const upperBound = Math.min(MAX_BET_STARS, Math.max(MIN_BET_STARS, max ?? MAX_BET_STARS))

  // Значение всегда должно попадать в границы: иначе кнопка подтверждения
  // блокируется суммой, которую всё равно нельзя поставить.
  useEffect(() => {
    if (value > upperBound) {
      onChange(upperBound)
    }
  }, [value, upperBound, onChange])

  const current = Math.min(Math.max(value, MIN_BET_STARS), upperBound)

  /**
   * Черновик поля ручного ввода: пользователь может набрать любую сумму,
   * не получая пересчёт на каждый символ. Коммит — на blur/Enter.
   */
  const [draft, setDraft] = useState(String(current))
  /** Свои коэффициенты быстрых кнопок (по умолчанию ×2 и ½). */
  const [multipliers, setMultipliers] = useState<[number, number]>(loadMultipliers)
  /** Черновики полей коэффициентов: ввод дробей не должен сбрасываться. */
  const [multiplierDrafts, setMultiplierDrafts] = useState<[string, string]>([
    String(multipliers[0]),
    String(multipliers[1]),
  ])
  /** Редактор коэффициентов открыт. */
  const [editingMultipliers, setEditingMultipliers] = useState(false)

  useEffect(() => {
    setMultiplierDrafts([String(multipliers[0]), String(multipliers[1])])
  }, [multipliers])

  // Внешнее значение (слайдер, кнопки ×2/×3/MAX, сброс после спина)
  // всегда перерисовывает поле.
  useEffect(() => {
    setDraft(String(current))
  }, [current])

  const clamp = (stars: number): number =>
    Math.min(upperBound, Math.max(MIN_BET_STARS, Math.round(stars)))

  const commit = (): void => {
    const parsed = Number(draft.replace(/\s/g, '').replace(',', '.'))
    const next = Number.isFinite(parsed) ? clamp(parsed) : current
    setDraft(String(next))
    if (next !== current) {
      onChange(next)
    }
  }

  const applyMultiplier = (multiplier: number): void => {
    const next = clamp(current * multiplier)
    setDraft(String(next))
    if (next !== current) {
      onChange(next)
    }
  }

  const saveMultiplier = (index: 0 | 1, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      return
    }
    const next: [number, number] = [...multipliers] as [number, number]
    next[index] = clampMultiplier(value)
    setMultipliers(next)
    try {
      localStorage.setItem(QUICK_MULTIPLIERS_KEY, JSON.stringify(next))
    } catch {
      // Приватный режим браузера — настройка просто не сохранится.
    }
  }

  /** Коммит поля коэффициента на blur/Enter: «0.» не теряется в процессе ввода. */
  const commitMultiplier = (index: 0 | 1): void => {
    const parsed = Number(multiplierDrafts[index].replace(',', '.'))
    const value =
      Number.isFinite(parsed) && parsed > 0
        ? clampMultiplier(parsed)
        : multipliers[index]
    saveMultiplier(index, value)
    setMultiplierDrafts((prev) => {
      const next: [string, string] = [...prev] as [string, string]
      next[index] = String(value)
      return next
    })
  }

  const applyMax = (): void => {
    setDraft(String(upperBound))
    if (upperBound !== current) {
      onChange(upperBound)
    }
  }

  return (
    <div className={`bet-slider ${compact ? 'bet-slider--compact' : ''}`}>
      <div className="bet-slider__head">
        <span className="bet-slider__label">{label}</span>
        <label className="bet-slider__manual">
          <span className="bet-slider__manual-prefix">
            <Star size={13} fill="currentColor" />
          </span>
          <input
            className="bet-slider__number"
            type="number"
            inputMode="numeric"
            min={MIN_BET_STARS}
            max={upperBound}
            step={1}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit()
                event.currentTarget.blur()
              }
            }}
            aria-label={`${label}: сумма в звёздах`}
          />
        </label>
      </div>

      <input
        className="bet-slider__input"
        type="range"
        min={MIN_BET_STARS}
        max={upperBound}
        step={BET_STEP}
        value={current}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${label} в звёздах`}
      />

      <div className="bet-slider__quick">
        {multipliers.map((multiplier, index) => (
          <button
            key={`${index}-${multiplier}`}
            type="button"
            className="bet-slider__chip"
            onClick={() => applyMultiplier(multiplier)}
            disabled={
              disabled ||
              (multiplier >= 1 ? current >= upperBound : current <= MIN_BET_STARS)
            }
            title={`Умножить ставку на ${multiplier}`}
          >
            {labelOfMultiplier(multiplier)}
          </button>
        ))}
        <button
          type="button"
          className="bet-slider__chip bet-slider__chip--max"
          onClick={applyMax}
          disabled={disabled || current >= upperBound}
        >
          MAX
        </button>
        <button
          type="button"
          className={`bet-slider__chip bet-slider__chip--edit ${
            editingMultipliers ? 'bet-slider__chip--edit-active' : ''
          }`}
          onClick={() => setEditingMultipliers((open) => !open)}
          disabled={disabled}
          aria-label="Изменить быстрые кнопки"
          aria-expanded={editingMultipliers}
          title="Свои коэффициенты"
        >
          <Pencil size={14} />
        </button>
      </div>

      {editingMultipliers && (
        <div className="bet-slider__custom">
          <span className="bet-slider__custom-title">Свои кнопки</span>
          {([0, 1] as const).map((index) => (
            <label key={index} className="bet-slider__custom-row">
              <span>{index === 0 ? 'Первая' : 'Вторая'}</span>
              <span className="bet-slider__custom-prefix">×</span>
              <input
                className="bet-slider__custom-input"
                type="text"
                inputMode="decimal"
                value={multiplierDrafts[index]}
                aria-label={`Коэффициент ${index === 0 ? 'первой' : 'второй'} кнопки`}
                onChange={(event) =>
                  setMultiplierDrafts((prev) => {
                    const next: [string, string] = [...prev] as [string, string]
                    next[index] = event.target.value
                    return next
                  })
                }
                onBlur={() => commitMultiplier(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMultiplier(index)
                    event.currentTarget.blur()
                  }
                }}
              />
            </label>
          ))}
          <span className="bet-slider__custom-hint">
            Например 3 — будет кнопка ×3, 0.5 — половина
          </span>
          <div className="bet-slider__custom-actions">
            <button
              type="button"
              className="bet-slider__custom-reset"
              onClick={() => {
                setMultipliers(DEFAULT_MULTIPLIERS)
                try {
                  localStorage.removeItem(QUICK_MULTIPLIERS_KEY)
                } catch {
                  // Нечего чистить — просто возвращаем значения по умолчанию.
                }
              }}
            >
              Сброс
            </button>
            <button
              type="button"
              className="bet-slider__custom-done"
              onClick={() => setEditingMultipliers(false)}
            >
              Готово
            </button>
          </div>
        </div>
      )}

      <div className="bet-slider__bounds">
        <span className="inline-flex items-center gap-0.5">
          {MIN_BET_STARS}
          <Star size={10} fill="currentColor" />
        </span>
        <span className="inline-flex items-center gap-0.5">
          {upperBound}
          <Star size={10} fill="currentColor" />
        </span>
      </div>

      {balance !== undefined && (
        <div className="bet-slider__balance inline-flex items-center gap-1">
          Баланс: {balance}
          <Star size={11} fill="currentColor" />
        </div>
      )}
    </div>
  )
}
