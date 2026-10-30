import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Plus, Sparkles, Star, Target, X } from 'lucide-react'
import type {
  CaseItem,
  InventoryItem,
  Prize,
  UpgraderResult,
  UpgraderTargetNft,
} from '../api/types'
import { ApiError, getCases, getInventory, upgraderUpgrade } from '../api/client'
import { errorFeedback, successFeedback, tapFeedback } from '../telegram'
import { prizeImage } from '../utils/assets'
import AssetImage from '../components/AssetImage'

type Phase = 'idle' | 'spinning' | 'result'

export interface UpgraderPageProps {
  balance: number
  /** Обновляет профиль (баланс и счётчик инвентаря) после апгрейда. */
  onRefreshMe: () => Promise<void> | void
  /** Мгновенное оптимистичное обновление баланса в шапке. */
  onBalanceChange?: (newBalance: number) => void
}

/** Границы совпадают с серверной валидацией (services/upgrader.ts). */
const MIN_TOTAL_BET = 10
/** Лимит только на ставку: выиграть можно и NFT дороже 25 000 ⭐. */
const MAX_TOTAL_BET = 25_000
const MIN_STARS_BET = 0
const MIN_CHANCE = 1
const MAX_CHANCE = 80
const PAYOUT_PERCENT = 95
const DEFAULT_STARS_BET = 100
/** 25% при ставке 100 ⭐ даёт выплату 380 ⭐ — сразу покрывает дешёвый NFT. */
const DEFAULT_CHANCE = 25
/** Результат показываем не раньше, чем через 3 секунды. */
const SPIN_MS = 3000

const QUICK_CHANCES = [1, 10, 25, 50, 75] as const

/** Колесо: r=88 в viewBox 200×200. */
const GAUGE_RADIUS = 88
const GAUGE_LENGTH = 2 * Math.PI * GAUGE_RADIUS
/** Сколько полных оборотов делает стрелка за один спин. */
const SPIN_TURNS = 7

const MAX_BET_LABEL = MAX_TOTAL_BET.toLocaleString('ru-RU')

const CONFETTI_COLORS = ['#ffd54a', '#ff6b6b', '#4ecdc4', '#a78bfa', '#f472b6', '#7dd3fc']

/** Множитель для шанса: 1% → x95, 10% → x9.5, 50% → x1.9. */
function multiplierOf(chance: number): number {
  return PAYOUT_PERCENT / chance
}

/** «95», «9.5», «1.9» — без лишних нулей. */
function formatMultiplier(multiplier: number): string {
  return Number(multiplier.toFixed(2)).toString()
}

/** Выплата: ставка × 95 / шанс, округлённая вниз как на сервере. */
function payoutOf(totalBet: number, chance: number): number {
  return Math.floor(totalBet * (PAYOUT_PERCENT / chance))
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'Не удалось провести апгрейд'
}

/** Кусочки конфетти: позиции и тайминги считаем один раз на монтирование. */
function Confetti({ pieces = 40 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 1.9 + Math.random() * 1.3,
        width: 6 + Math.random() * 6,
        height: 9 + Math.random() * 7,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    [pieces],
  )

  return (
    <div className="upgrader__confetti" aria-hidden="true">
      {items.map((piece) => (
        <span
          key={piece.id}
          className="upgrader__confetti-piece"
          style={{
            left: `${piece.left}%`,
            width: `${piece.width}px`,
            height: `${piece.height}px`,
            backgroundColor: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Ключ карточки цели. `prize.id` может повторяться между кейсами,
 * поэтому к id добавляем имя — клик и подсветка всегда про одну карточку.
 */
const targetKey = (target: { id: string; name: string }): string => `${target.id}|${target.name}`

export default function UpgraderPage({
  balance,
  onRefreshMe,
  onBalanceChange,
}: UpgraderPageProps) {
  const [starsBet, setStarsBet] = useState(DEFAULT_STARS_BET)
  const [starsDraft, setStarsDraft] = useState(String(DEFAULT_STARS_BET))
  const [chance, setChance] = useState(DEFAULT_CHANCE)
  const [nftIds, setNftIds] = useState<string[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cases, setCases] = useState<CaseItem[]>([])
  const [catalog, setCatalog] = useState<Prize[]>([])
  const [casesLoading, setCasesLoading] = useState(true)
  /** Явно выбранный игроком NFT в сетке целей (null → авто-подбор по выплате). */
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<UpgraderResult | null>(null)
  const [resultChance, setResultChance] = useState(DEFAULT_CHANCE)
  const [error, setError] = useState<string | null>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const spinRef = useRef<Animation | null>(null)

  const showError = (message: string) => {
    setError(message)
    setTimeout(() => {
      setError((current) => (current === message ? null : current))
    }, 3500)
  }

  const loadInventory = async (): Promise<InventoryItem[]> => {
    try {
      const res = await getInventory()
      setInventory(res.items)
      // Проданные/выведенные NFT не должны оставаться в выбранной ставке.
      const available = new Set(res.items.map((item) => item.id))
      setNftIds((current) => current.filter((id) => available.has(id)))
      return res.items
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Не удалось загрузить инвентарь')
      return []
    } finally {
      setInventoryLoading(false)
    }
  }

  const loadCases = async (): Promise<void> => {
    try {
      const res = await getCases()
      setCases(res.cases)
      setCatalog(res.nftCatalog ?? [])
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Не удалось загрузить предметы')
    } finally {
      setCasesLoading(false)
    }
  }

  useEffect(() => {
    void loadInventory()
    void loadCases()
  }, [])

  // Внешнее изменение ставки всегда перерисовывает поле ручного ввода.
  useEffect(() => {
    setStarsDraft(String(starsBet))
  }, [starsBet])

  /**
   * Пул целей: все NFT из кейсов и каталога, по одному на название.
   * Если цены отличаются, сохраняем более дорогой вариант.
   */
  const nftPool = useMemo<UpgraderTargetNft[]>(() => {
    const targets = new Map<string, UpgraderTargetNft>()

    const add = (prize: Prize): void => {
      if (prize.type !== 'NFT') {
        return
      }

      const key = prize.name.trim().toLowerCase()
      const existing = targets.get(key)
      if (existing && existing.price >= prize.price) {
        return
      }

      targets.set(key, {
        id: prize.id,
        name: prize.name,
        emoji: prize.emoji,
        price: prize.price,
      })
    }

    for (const caseItem of cases) {
      for (const prize of caseItem.prizes) {
        add(prize)
      }
    }
    for (const prize of catalog) {
      add(prize)
    }

    return [...targets.values()].sort((a, b) => a.price - b.price)
  }, [cases, catalog])

  const selectedItems = useMemo(
    () => inventory.filter((item) => nftIds.includes(item.id)),
    [inventory, nftIds],
  )

  const nftValue = selectedItems.reduce((sum, item) => sum + item.prizePrice, 0)
  const totalBet = starsBet + nftValue
  const cheapestTarget = nftPool[0] ?? null
  const cheapestPrice = cheapestTarget?.price ?? 350
  const maxChanceForCheapest = Math.floor((totalBet * PAYOUT_PERCENT) / cheapestPrice)
  const dynamicMaxChance = Math.min(
    MAX_CHANCE,
    Math.max(MIN_CHANCE, maxChanceForCheapest),
  )
  const nftBetTooSmall = maxChanceForCheapest < MIN_CHANCE
  const multiplier = multiplierOf(chance)
  const payout = payoutOf(totalBet, chance)

  /** Авто-подбор: самый дорогой NFT, который целиком помещается в выплату. */
  const autoTarget = useMemo(() => {
    const affordableTargets = nftPool.filter((item) => item.price <= payout)
    return affordableTargets[affordableTargets.length - 1] ?? null
  }, [nftPool, payout])
  const visibleTargets = isExpanded ? nftPool : nftPool.slice(0, 5)

  /** Карточка, выбранная игроком вручную (сравнение по уникальному ключу id+имя). */
  const selectedTarget = useMemo(
    () => (selectedTargetId ? nftPool.find((item) => targetKey(item) === selectedTargetId) ?? null : null),
    [nftPool, selectedTargetId],
  )

  // Ручной выбор приоритетнее авто-подбора: пока выбор валиден, цель — именно он.
  const requestTarget = selectedTarget ?? autoTarget
  const targetCovered = requestTarget ? payout >= requestTarget.price : false
  const change = requestTarget && targetCovered ? payout - requestTarget.price : 0

  // Уменьшение ставки может понизить доступный потолок шанса; сохраняем цель,
  // ограничивая только сам шанс, чтобы минимальная выплата покрывала дешевый NFT.
  useEffect(() => {
    if (chance > dynamicMaxChance) {
      setChance(dynamicMaxChance)
    }
  }, [chance, dynamicMaxChance])

  // Ручной выбор НЕ сбрасываем из-за шанса/выплаты — просто блокируем апгрейд
  // (targetCovered = false). Выбор обнуляется только если карточки больше нет в пуле
  // (предмет удалили из игры) — иначе подсветка «прыгала» бы на авто-подбор.
  useEffect(() => {
    if (!selectedTargetId) {
      return
    }
    const targetExists = nftPool.some((item) => targetKey(item) === selectedTargetId)
    if (!targetExists) {
      setSelectedTargetId(null)
    }
  }, [selectedTargetId, nftPool])

  /** Текущий угол стрелки в градусах 0–360. */
  const pointerAngle = (): number => {
    const el = pointerRef.current
    if (!el) {
      return 0
    }

    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    const deg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
    return (deg + 360) % 360
  }

  // В покое стрелка смотрит вверх (на начало зелёного сектора).
  useEffect(() => {
    if (phase !== 'idle' || !pointerRef.current) {
      return
    }

    spinRef.current?.cancel()
    spinRef.current = null
    pointerRef.current.style.transform = 'rotate(0deg)'
  }, [phase, requestTarget])

  const overBalance = starsBet > balance
  const tooSmall = totalBet < MIN_TOTAL_BET
  const tooBig = totalBet > MAX_TOTAL_BET
  const busy = phase === 'spinning'
  /** Блокируем настройки только на время спина. */
  const locked = busy
  const canPlay =
    !busy &&
    !tooSmall &&
    !tooBig &&
    !nftBetTooSmall &&
    !overBalance &&
    requestTarget !== null &&
    targetCovered

  const applyBet = (next: number): void => {
    tapFeedback('light')
    setStarsBet(Math.min(MAX_TOTAL_BET, Math.max(MIN_STARS_BET, Math.round(next))))
  }

  const commitStars = (): void => {
    const parsed = Number(starsDraft.replace(/\s/g, '').replace(',', '.'))
    const next = Number.isFinite(parsed)
      ? Math.min(MAX_TOTAL_BET, Math.max(MIN_STARS_BET, Math.round(parsed)))
      : starsBet
    setStarsDraft(String(next))
    setStarsBet(next)
  }

  const toggleNft = (id: string): void => {
    tapFeedback('light')
    setNftIds((current) =>
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
    )
  }

  const isTargetLocked = (target: UpgraderTargetNft): boolean => {
    if (target.price <= 0) {
      return true // защита от деления на ноль
    }
    const requiredChance = (totalBet * PAYOUT_PERCENT) / target.price
    return requiredChance < MIN_CHANCE || requiredChance > MAX_CHANCE
  }

  /**
   * Выбирает именно нажатую цель и округляет шанс вниз, чтобы выплата её покрыла.
   * Повторный клик по уже выбранной карточке снимает ручной выбор (возврат к авто-подбору).
   */
  const handleSelectTarget = (target: UpgraderTargetNft): void => {
    if (locked) {
      return
    }

    const key = targetKey(target)
    if (selectedTargetId === key) {
      tapFeedback('light')
      setSelectedTargetId(null)
      return
    }

    if (isTargetLocked(target)) {
      return
    }

    const requiredChance = Math.floor((totalBet * PAYOUT_PERCENT) / target.price)
    setSelectedTargetId(key)
    tapFeedback('light')
    if (requiredChance >= MIN_CHANCE && requiredChance <= MAX_CHANCE) {
      setChance(requiredChance)
    }
  }

  const handleUpgrade = async (): Promise<void> => {
    if (!canPlay || !requestTarget) {
      return
    }

    tapFeedback('medium')
    setPhase('spinning')
    setResult(null)
    setResultChance(chance)
    setError(null)

    // Сектора, в которые должна приехать стрелка.
    const greenSize = (chance / 100) * 360
    const winAngle = greenSize * (0.15 + Math.random() * 0.7)
    const margin = Math.min(6, greenSize / 4)
    const loseStart = greenSize + margin
    const loseAngle = loseStart + Math.random() * Math.max(1, 360 - loseStart - margin)

    try {
      const res = await upgraderUpgrade(nftIds, starsBet, chance, requestTarget.id)

      setResult(res)

      // Одна непрерывная прокрутка: ответ уже известен, поэтому стрелка
      // за один заход разгоняется и плавно встаёт в свой сектор — зелёный
      // при победе, красный при проигрыше. Никаких перезапусков и докруток.
      const targetAngle = res.win ? winAngle : loseAngle
      const el = pointerRef.current

      if (el) {
        const from = pointerAngle()
        const delta = ((targetAngle - from) % 360 + 360) % 360

        spinRef.current?.cancel()
        spinRef.current = el.animate(
          [
            { transform: `rotate(${from}deg)` },
            { transform: `rotate(${from + SPIN_TURNS * 360 + delta}deg)` },
          ],
          {
            duration: SPIN_MS,
            easing: 'cubic-bezier(0.12, 0.9, 0.16, 1)',
            fill: 'forwards',
          },
        )

        await new Promise((resolve) => setTimeout(resolve, SPIN_MS))
      }

      setPhase('result')

      if (res.win) {
        successFeedback()
      } else {
        errorFeedback()
      }

      // Сгоревшие NFT больше не выбираемы: обновляем список с сервера.
      setNftIds([])
      void loadInventory()
      onBalanceChange?.(balance - starsBet + res.remainingStars)
      void onRefreshMe()
    } catch (err: unknown) {
      // Ошибка до старта прокрутки — возвращаем стрелку в 0.
      spinRef.current?.cancel()
      spinRef.current = null
      if (pointerRef.current) {
        pointerRef.current.style.transform = 'rotate(0deg)'
      }
      errorFeedback()
      setPhase('idle')
      showError(formatError(err))
      // Сервер мог успеть списать ставку — синхронизируем баланс и инвентарь.
      void loadInventory()
      void onRefreshMe()
    }
  }

  return (
    <div className="upgrader">
      <h2 className="upgrader__title inline-flex items-center gap-2">
        <Sparkles size={20} className="text-[#FFD700]" />
        Апгрейдер
      </h2>
      <p className="upgrader__subtitle">
        Собери ставку из ⭐ и NFT. Цель автоматически меняется вместе с шансом и выплатой;
        NFT из ставки сгорают в любом случае.
      </p>

      {error && <div className="upgrader__error">{error}</div>}

      <div className="upgrader__grid">
        {/* 1. Ставка: ⭐ + NFT */}
        <section className="glass-card flex flex-col gap-3 p-4">
          <div className="upgrader__panel-head">
            <span className="upgrader__panel-title">1 · Ставка</span>
            <span className="upgrader__balance inline-flex items-center gap-1">
              Баланс: {balance}
              <Star size={11} fill="currentColor" />
            </span>
          </div>

          <div className="upgrader__stars-row">
            <label className="upgrader__stars-input">
              <span className="inline-flex items-center">
                <Star size={16} className="text-[#FFD700]" fill="currentColor" />
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_STARS_BET}
                max={MAX_TOTAL_BET}
                step={1}
                value={starsDraft}
                disabled={busy}
                onChange={(event) => setStarsDraft(event.target.value)}
                onBlur={commitStars}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitStars()
                    event.currentTarget.blur()
                  }
                }}
                aria-label="Ставка в звёздах"
              />
            </label>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              className="ghost-btn py-2 text-xs"
              onClick={() => applyBet(starsBet + 100)}
              disabled={busy}
            >
              +100
            </button>
            <button
              type="button"
              className="ghost-btn py-2 text-xs"
              onClick={() => applyBet(Math.max(50, Math.floor(starsBet / 2)))}
              disabled={busy}
            >
              1/2
            </button>
            <button
              type="button"
              className="ghost-btn py-2 text-xs"
              onClick={() => applyBet(starsBet * 2)}
              disabled={busy}
            >
              ×2
            </button>
            <button
              type="button"
              className="ghost-btn py-2 text-xs"
              onClick={() => applyBet(Math.min(balance, MAX_TOTAL_BET))}
              disabled={busy}
            >
              MAX
            </button>
          </div>

          <button
            type="button"
            className="ghost-btn upgrader__add-nft flex items-center justify-center gap-1.5 py-2.5 text-[13px]"
            onClick={() => {
              tapFeedback('light')
              setPickerOpen(true)
            }}
            disabled={busy}
          >
            <Plus size={14} />
            Добавить NFT
          </button>

          {selectedItems.length > 0 ? (
            <div className="upgrader__nft-grid">
              {selectedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="upgrader__nft"
                  onClick={() => toggleNft(item.id)}
                  disabled={busy}
                  title={`Убрать ${item.prizeName}`}
                >
                  <AssetImage
                    src={prizeImage(item.prizeName, item.prizeEmoji)}
                    alt={item.prizeName}
                    className="h-8 w-8"
                  />
                  <span className="upgrader__nft-name">{item.prizeName}</span>
                  <span className="upgrader__nft-price inline-flex items-center gap-0.5">
                    {item.prizePrice}
                    <Star size={9} fill="currentColor" />
                  </span>
                  <span className="upgrader__nft-remove" aria-hidden="true">
                    <X size={12} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="upgrader__hint">
              {inventoryLoading ? 'Загружаем инвентарь…' : 'NFT не выбраны — ставка только ⭐'}
            </div>
          )}

          <div className={`upgrader__total ${tooBig ? 'upgrader__total--over' : ''}`}>
            <span>Ставка итого</span>
            <strong className="inline-flex items-center gap-1">
              {totalBet}
              <Star size={14} fill="currentColor" />
            </strong>
          </div>

          {tooBig && (
            <div className="upgrader__hint upgrader__hint--warn">
              Максимум {MAX_BET_LABEL} ⭐ — убери NFT или уменьши ставку
            </div>
          )}
        </section>

        {/* 2. Шанс */}
        <section className="glass-card flex flex-col gap-3 p-4">
          <div className="upgrader__panel-head">
            <span className="upgrader__panel-title">2 · Шанс</span>
            <span className="upgrader__balance">победа</span>
          </div>

          <div className="upgrader__wheel-wrap">
            <div
              className={`upgrader__wheel ${busy ? 'upgrader__wheel--spinning' : ''} ${
                phase === 'result' && result
                  ? result.win
                    ? 'upgrader__wheel--win'
                    : 'upgrader__wheel--lose'
                  : ''
              }`}
            >
              <svg viewBox="0 0 200 200" className="upgrader__wheel-svg" aria-hidden="true">
                <circle cx="100" cy="100" r={GAUGE_RADIUS} className="upgrader__wheel-track" />
                <circle
                  cx="100"
                  cy="100"
                  r={GAUGE_RADIUS}
                  className="upgrader__wheel-arc upgrader__wheel-arc--lose"
                  strokeDasharray={`${GAUGE_LENGTH * (1 - chance / 100)} ${GAUGE_LENGTH}`}
                  strokeDashoffset={-GAUGE_LENGTH * (chance / 100)}
                  transform="rotate(-90 100 100)"
                />
                <circle
                  cx="100"
                  cy="100"
                  r={GAUGE_RADIUS}
                  className="upgrader__wheel-arc upgrader__wheel-arc--win"
                  strokeDasharray={`${GAUGE_LENGTH * (chance / 100)} ${GAUGE_LENGTH}`}
                  transform="rotate(-90 100 100)"
                />
              </svg>

              <div ref={pointerRef} className="upgrader__wheel-pointer">
                <span className="upgrader__wheel-needle" />
              </div>

              <span className="upgrader__wheel-hub" aria-hidden="true" />
            </div>

            <div className="upgrader__wheel-readout">
              <span className="upgrader__gauge-chance">{chance}%</span>
              <span className="upgrader__gauge-multiplier">
                ×{formatMultiplier(multiplier)}
              </span>
              <span className="upgrader__gauge-sub">шанс победы</span>
            </div>

            <div className="upgrader__wheel-legend">
              <span className="upgrader__wheel-legend-item">
                <i className="upgrader__wheel-dot upgrader__wheel-dot--win" /> зелёное —
                победа
              </span>
              <span className="upgrader__wheel-legend-item">
                <i className="upgrader__wheel-dot upgrader__wheel-dot--lose" /> красное —
                проигрыш
              </span>
            </div>
          </div>

          <input
            className="upgrader__range"
            type="range"
            min={MIN_CHANCE}
            max={dynamicMaxChance}
            step={1}
            value={chance}
            disabled={locked || nftBetTooSmall || dynamicMaxChance === MIN_CHANCE}
            onChange={(event) => setChance(Math.min(dynamicMaxChance, Number(event.target.value)))}
            aria-label="Шанс победы в процентах"
          />
          <div className="upgrader__bounds">
            <span>{MIN_CHANCE}%</span>
            <span>{dynamicMaxChance}%</span>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {QUICK_CHANCES.map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-xl border py-2 text-[11px] font-extrabold transition ${
                  chance === value
                    ? 'border-[#FFD700] bg-[#FFD700] text-black'
                    : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#FFD700]/50 hover:text-white'
                }`}
                aria-pressed={chance === value}
                disabled={locked || value > dynamicMaxChance || nftBetTooSmall}
                onClick={() => {
                  tapFeedback('light')
                  setChance(Math.min(value, dynamicMaxChance))
                }}
              >
                {value}%
              </button>
            ))}
          </div>

          <div className="upgrader__payout">
            Выплата при победе:{' '}
            <strong className="inline-flex items-center gap-0.5">
              {payout}
              <Star size={12} fill="currentColor" />
            </strong>
          </div>
          {nftBetTooSmall && (
            <p className="m-0 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
              Ставка слишком мала для получения NFT
            </p>
          )}
        </section>

        {/* 3. Цель: автоматически выбирается по текущей выплате */}
        <section className="glass-card flex flex-col gap-3 p-4">
          <div className="upgrader__panel-head">
            <span className="upgrader__panel-title inline-flex items-center gap-1.5">
              <Target size={14} className="text-[#FFD700]" />
              3 · Цель
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#FFD700]/35 bg-[#FFD700]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#FFE680]">
              <Sparkles size={12} />
              {selectedTarget ? 'Выбрано вручную' : 'Авто-подбор'}
            </span>
          </div>

          {casesLoading ? (
            <div className="upgrader__hint">Загружаем предметы…</div>
          ) : (
            <>
              {requestTarget ? (
                <div
                  className={`flex items-center gap-3 rounded-2xl border p-3 ${
                    targetCovered
                      ? 'border-emerald-400/50 bg-emerald-500/10'
                      : 'border-red-400/50 bg-red-500/10'
                  }`}
                >
                  <AssetImage
                    src={prizeImage(requestTarget.name, requestTarget.emoji)}
                    alt={requestTarget.name}
                    className="h-14 w-14 shrink-0"
                    glow={
                      targetCovered ? 'rgba(34,197,94,0.5)' : 'rgba(248,113,113,0.5)'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-extrabold text-white">
                      {requestTarget.name}
                    </p>
                    <p className="m-0 inline-flex items-center gap-1 text-xs font-bold text-[#FFD700]">
                      {requestTarget.price}
                      <Star size={11} fill="currentColor" />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {targetCovered ? 'Сдача' : 'Звёздами'}
                    </p>
                    <p
                      className={`m-0 inline-flex items-center gap-1 text-sm font-extrabold ${
                        targetCovered ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      +{targetCovered ? change : payout}
                      <Star size={11} fill="currentColor" />
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                  <p className="m-0 text-sm font-extrabold text-white">
                    Пока ничего не помещается
                  </p>
                  <p className="m-0 mt-1 text-xs leading-relaxed text-gray-400">
                    Выплаты {payout} ⭐ не хватает на самый дешёвый NFT
                    {cheapestTarget ? ` (${cheapestTarget.price} ⭐)` : ''}. Подними ставку
                    или уменьши шанс.
                  </p>
                </div>
              )}

              {selectedTarget && !targetCovered && (
                <p className="m-0 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
                  Выплаты не хватает. Уменьшите шанс или увеличьте ставку.
                </p>
              )}

              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                    selectedTargetId
                      ? 'bg-[#FFD700]/15 text-[#FFD700]'
                      : 'bg-white/5 text-gray-400'
                  }`}
                >
                  {selectedTargetId ? 'Выбрано вручную' : 'Авто-подбор'}
                </span>
                {selectedTargetId && (
                  <button
                    type="button"
                    className="bg-transparent text-[11px] font-bold text-gray-400 transition hover:text-white"
                    onClick={() => {
                      tapFeedback('light')
                      setSelectedTargetId(null)
                    }}
                  >
                    Сбросить на авто
                  </button>
                )}
              </div>

              <div className="upgrader__hint">
                Нажми на NFT ниже, чтобы зафиксировать цель и подобрать шанс под её цену.
                Повторный клик снимает выбор.
              </div>

              <div className="grid grid-cols-4 gap-2 pr-1">
                {visibleTargets.map((nft) => {
                  const key = targetKey(nft)
                  const manual = selectedTargetId === key
                  const active =
                    (selectedTargetId ?? (autoTarget ? targetKey(autoTarget) : null)) === key
                  const requiredChance = (totalBet * PAYOUT_PERCENT) / nft.price
                  const lockedByChance = isTargetLocked(nft)
                  /** Выплата покрывает цену карточки — если нет, рамка краснеет (выбор остаётся). */
                  const covered = payout >= nft.price
                  const lockReason =
                    requiredChance > MAX_CHANCE
                      ? 'Слишком высокий шанс'
                      : requiredChance < MIN_CHANCE
                        ? 'Слишком низкий шанс'
                        : null

                  return (
                    <button
                      key={key}
                      type="button"
                      className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition active:scale-95 ${
                        active
                          ? covered
                            ? 'border-[#FFD700] bg-[#FFD700]/15'
                            : 'border-red-400 bg-red-500/15'
                          : lockedByChance
                            ? 'cursor-not-allowed opacity-50 grayscale'
                            : 'border-white/10 bg-white/5 hover:border-[#FFD700]/40'
                      }`}
                      disabled={locked || (lockedByChance && !manual)}
                      onClick={() => handleSelectTarget(nft)}
                      title={
                        lockReason ?? `Подобрать шанс для ${nft.name} · ${nft.price} ⭐`
                      }
                      aria-label={`${nft.name}, ${nft.price} звёзд${lockReason ? `, ${lockReason}` : ''}`}
                    >
                      <span className="relative inline-flex h-8 w-8 items-center justify-center">
                        <AssetImage
                          src={prizeImage(nft.name, nft.emoji)}
                          alt={nft.name}
                          className="h-8 w-8"
                        />
                        {lockedByChance && (
                          <Lock
                            size={16}
                            className="absolute text-white drop-shadow"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="w-full truncate text-[10px] font-bold text-white">
                        {nft.name}
                      </span>
                      {lockReason ? (
                        <span className="text-[9px] font-bold leading-tight text-red-400">
                          {lockReason}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-gray-400">
                          {nft.price}
                          <Star size={9} fill="currentColor" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {nftPool.length > 5 && (
                <button
                  type="button"
                  className="self-center bg-transparent px-2 py-1 text-xs font-semibold text-gray-400 transition hover:text-white"
                  onClick={() => setIsExpanded((expanded) => !expanded)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? 'Свернуть ⬆️' : 'Показать все NFT ⬇️'}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {!canPlay && !busy && (
        <div className="upgrader__hint upgrader__hint--warn">
          {tooBig
            ? `Максимум ${MAX_BET_LABEL} ⭐`
            : overBalance
              ? `Недостаточно ⭐ на балансе (${balance})`                : tooSmall
                  ? `Минимальная ставка — ${MIN_TOTAL_BET} ⭐`
                : requestTarget && !targetCovered
                  ? `Выплаты не хватит на ${requestTarget.name}`
                : 'Не хватает на NFT'}
        </div>
      )}

      <button
        type="button"
        className="gold-btn upgrader__play animate-pulse-glow"
        onClick={() => void handleUpgrade()}
        disabled={!canPlay}
      >
        {busy
          ? 'Крутим…'
          : requestTarget && targetCovered
            ? `Апгрейд · ${totalBet}`
            : 'Не хватает на NFT'}
      </button>
      {busy && (
        <div className="upgrader__hint animate-pulse text-center">
          Определяем, что попадёт в выплату…
        </div>
      )}

      <div
        className={`upgrader__forecast ${requestTarget && targetCovered ? '' : 'upgrader__forecast--low'}`}
      >
          {requestTarget && targetCovered ? (
            <>
              Вы получите <strong>{requestTarget.name}</strong> +{' '}
              <strong className="inline-flex items-center gap-0.5">
                {change}
                <Star size={12} fill="currentColor" />
              </strong>{' '}
              сдачи ⭐
            </>
          ) : requestTarget ? (
            <>
              Выплаты не хватит на <strong>{requestTarget.name}</strong>. Вы получите{' '}
              <strong className="inline-flex items-center gap-0.5">
                {payout}
                <Star size={12} fill="currentColor" />
              </strong>{' '}
              ⭐
            </>
          ) : (
            <>
              Вы получите{' '}
              <strong className="inline-flex items-center gap-0.5">
                {payout}
                <Star size={12} fill="currentColor" />
              </strong>{' '}
              ⭐ — на самый дешёвый NFT не хватает
            </>
          )}
      </div>

      {phase === 'result' && result && (
        <div
          className={`upgrader__result ${
            result.win ? 'upgrader__result--win' : 'upgrader__result--lose'
          }`}
        >
          {result.win && result.receivedNft && <Confetti />}

          <div className="upgrader__result-title">
            {result.win
              ? result.receivedNft
                ? 'Предмет у тебя!'
                : `Выигрыш +${result.remainingStars}`
              : 'Проигрыш'}
          </div>

          {result.win && result.receivedNft && (
            <div className="upgrader__prize-card">
              <AssetImage
                src={prizeImage(result.receivedNft.name, result.receivedNft.emoji)}
                alt={result.receivedNft.name}
                className="h-14 w-14"
              />
              <span className="upgrader__prize-name">{result.receivedNft.name}</span>
              <span className="upgrader__prize-price inline-flex items-center gap-0.5">
                {result.receivedNft.price}
                <Star size={11} fill="currentColor" />
              </span>
              <span className="upgrader__prize-change inline-flex items-center gap-0.5">
                + {result.remainingStars}
                <Star size={10} fill="currentColor" /> сдачи на баланс
              </span>
            </div>
          )}

          <div className="upgrader__result-meta">
            Ставка {result.totalBet} ⭐ · шанс {resultChance}% · множитель ×
            {formatMultiplier(result.multiplier)}
          </div>

        </div>
      )}

      {/* Модалка выбора NFT из инвентаря */}
      {pickerOpen && (
        <div className="upgrader-picker" role="dialog" aria-modal="true" aria-label="Выбор NFT">
          <div
            className="upgrader-picker__backdrop"
            onClick={() => {
              if (!busy) {
                setPickerOpen(false)
              }
            }}
          />

          <div className="upgrader-picker__panel">
            <div className="upgrader-picker__head">
              <h3 className="upgrader-picker__title">Выбери NFT</h3>
              <button
                type="button"
                className="upgrader-picker__close inline-flex items-center justify-center"
                onClick={() => setPickerOpen(false)}
                disabled={busy}
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            {inventoryLoading ? (
              <div className="upgrader-picker__empty">Загрузка инвентаря…</div>
            ) : inventory.length === 0 ? (
              <div className="upgrader-picker__empty">В инвентаре пока нет NFT</div>
            ) : (
              <div className="upgrader-picker__list">
                {inventory.map((item) => {
                  const selected = nftIds.includes(item.id)
                  const claimed = item.status === 'CLAIMED'

                  return (
                    <label
                      key={item.id}
                      className={`upgrader-picker__row ${
                        selected ? 'upgrader-picker__row--selected' : ''
                      } ${claimed ? 'upgrader-picker__row--disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={busy || claimed}
                        onChange={() => toggleNft(item.id)}
                      />
                      <AssetImage
                        src={prizeImage(item.prizeName, item.prizeEmoji)}
                        alt={item.prizeName}
                        className="h-7 w-7"
                      />
                      <span className="upgrader-picker__name">{item.prizeName}</span>
                      <span className="upgrader-picker__price inline-flex items-center gap-0.5">
                        {item.prizePrice}
                        <Star size={11} fill="currentColor" />
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="upgrader-picker__summary inline-flex items-center gap-1">
              Выбрано {selectedItems.length} NFT · {nftValue}
              <Star size={11} fill="currentColor" />
            </div>

            <button
              type="button"
              className="gold-btn w-full py-3 text-sm"
              onClick={() => setPickerOpen(false)}
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
