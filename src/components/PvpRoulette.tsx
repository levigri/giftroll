import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { PvpParticipantView } from '../api/types'

export interface PvpRouletteProps {
  /** Участники раунда: { userId, username, stars, isBot, isMe }. */
  participants: PvpParticipantView[]
  /** Кто победил по решению сервера (нужен для угла остановки и показа результата). */
  winnerId: string | null
  /** Текущий статус раунда / страницы. */
  status?: 'idle' | 'in_round' | 'spinning' | 'result'
  /** Идентификатор раунда. */
  roundId?: string
  /** Колбэк по завершении анимации спина (через 2500 мс). */
  onSpinEnd?: () => void
  /** Для обратной совместимости: пока true, считается status = 'spinning'. */
  spinning?: boolean
}

/** Длительность прокрутки — 2.5 секунды. */
export const SPIN_DURATION_MS = 2500
/**
 * Запас к длительности анимации для страховочного таймера: нормальный путь —
 * transitionend, но он может задержаться на кадр или не прийти вовсе.
 */
export const SPIN_END_FALLBACK_MS = 250

const SIZE = 240
const CENTER = SIZE / 2
const RADIUS = 100
/** Полные обороты перед остановкой — чтобы «раскрутка» была видна. */
const FULL_SPINS = 5
/** Подписи рисуем только на секторах от 25°. */
const LABEL_MIN_SWEEP_DEG = 25
/** Радиус подписи: ближе к краю колеса, по центру сектора. */
const LABEL_RADIUS = RADIUS * 0.66
/** Максимальная длина ника на секторе. */
const NAME_MAX_LENGTH = 10

/** Точка на окружности: 0° — вверху (под указателем), дальше по часовой стрелке. */
function polar(radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)]
}

function sectorPath(startDeg: number, endDeg: number): string {
  if (endDeg - startDeg >= 359.99) {
    return `M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER + RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER - RADIUS} Z`
  }
  const [x1, y1] = polar(RADIUS, startDeg)
  const [x2, y2] = polar(RADIUS, endDeg)
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  return `M ${CENTER} ${CENTER} L ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`
}

/** Детерминированный оттенок участника из его id — у одного игрока он всегда один. */
function hueOf(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 100000
  }
  return (hash * 137.508) % 360
}

/** HSL(h, 70%, 50%) → относительная яркость 0..1. */
function luminanceOf(hue: number): number {
  const saturation = 0.7
  const lightness = 0.5
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2

  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) {
    ;[r, g, b] = [c, x, 0]
  } else if (hue < 120) {
    ;[r, g, b] = [x, c, 0]
  } else if (hue < 180) {
    ;[r, g, b] = [0, c, x]
  } else if (hue < 240) {
    ;[r, g, b] = [0, x, c]
  } else if (hue < 300) {
    ;[r, g, b] = [x, 0, c]
  } else {
    ;[r, g, b] = [c, 0, x]
  }

  return 0.2126 * (r + m) + 0.7152 * (g + m) + 0.0722 * (b + m)
}

/** Обводка моего сектора: белая на тёмном, тёмная на светлом. */
function contrastStrokeOf(hue: number): string {
  return luminanceOf(hue) > 0.55 ? '#111111' : '#ffffff'
}

/** Ник участника для легенды: у меня — с пометкой «(ты)». */
export function nameOf(participant: PvpParticipantView): string {
  const base = participant.username ?? (participant.isBot ? 'Test Bot' : 'Игрок')
  return participant.isMe ? `${base} (ты)` : base
}

/** Короткая подпись прямо на секторе. */
function shortNameOf(participant: PvpParticipantView): string {
  if (participant.isMe) {
    return 'Вы'
  }
  const base = participant.username ?? (participant.isBot ? 'Бот' : 'Игрок')
  return base.length > NAME_MAX_LENGTH ? `${base.slice(0, NAME_MAX_LENGTH - 1)}…` : base
}

export interface Sector {
  userId: string
  name: string
  shortName: string
  stars: number
  isMe: boolean
  start: number
  /** Угол сектора в градусах: stars / totalStars × 360°. */
  sweep: number
  center: number
  color: string
  stroke: string
  /** Процент банка, он же шанс победы. */
  percent: number
}

/** Параметры одного спина: считаются РОВНО ОДИН РАЗ — в момент старта анимации. */
export interface SpinState {
  /** Раунд, который крутим: защита от повторного спина того же раунда. */
  spinId: string
  targetAngle: number
  /** Случайное смещение от центра сектора победителя, не больше ±30% его ширины. */
  offset: number
  /** Колбэк окончания анимации уже вызван. */
  fired: boolean
}

/** Порядок участников на колесе: мой сектор первый (0°), остальные — по убыванию ставки. */
function orderParticipants(participants: PvpParticipantView[]): PvpParticipantView[] {
  return [...participants].sort((a, b) => {
    if (a.isMe !== b.isMe) {
      return a.isMe ? -1 : 1
    }
    return b.stars - a.stars
  })
}

/**
 * Угол остановки и небольшое случайное смещение относительно центра победителя.
 * 1. Сектора считаются ровно как на колесе: sweep = stars / totalStars × 360°.
 * 2. centerAngle — середина сектора победителя, sectorWidth — его ширина.
 * 3. offset равномерно выбирается в диапазоне ±30% ширины сектора, поэтому
 *    указатель всегда остаётся внутри сектора и останавливается около его центра.
 * 4. targetAngle = 360 × 5 − (centerAngle + offset) — 5 полных оборотов + остановка
 *    (угол 0° — под указателем сверху).
 *
 * Проверка: при 5000 против 2500 сектора 240°/120° (не 50/50), а указатель
 * останавливается внутри сектора победителя.
 */
export function computeSpinTarget(
  participants: PvpParticipantView[],
  winnerId: string | null,
): { targetAngle: number; offset: number; sectorWidth: number } {
  const total = participants.reduce((sum, p) => sum + p.stars, 0)
  if (participants.length === 0 || total <= 0 || winnerId === null) {
    return { targetAngle: 360 * FULL_SPINS, offset: 0, sectorWidth: 0 }
  }

  let angle = 0
  let winnerSector: { sweep: number; center: number } | null = null

  for (const participant of orderParticipants(participants)) {
    const sweep = (participant.stars / total) * 360
    if (participant.userId === winnerId) {
      winnerSector = { sweep, center: angle + sweep / 2 }
      break
    }
    angle += sweep
  }

  if (winnerSector === null) {
    return { targetAngle: 360 * FULL_SPINS, offset: 0, sectorWidth: 0 }
  }

  const sectorWidth = winnerSector.sweep
  const centerAngle = winnerSector.center

  const offset = (Math.random() * 0.6 - 0.3) * sectorWidth

  return { targetAngle: 360 * FULL_SPINS - (centerAngle + offset), offset, sectorWidth }
}

/** Угол остановки колеса в градусах. */
export function computeTargetAngle(
  participants: PvpParticipantView[],
  winnerId: string | null,
): number {
  return computeSpinTarget(participants, winnerId).targetAngle
}

function PvpRoulette({
  participants,
  winnerId,
  status: statusProp,
  roundId,
  onSpinEnd,
  spinning = false,
}: PvpRouletteProps) {
  const currentStatus = statusProp ?? (spinning ? 'spinning' : 'in_round')

  /**
   * БАГ №5: Секторы колеса: угол строго пропорционален ставкам участников.
   * totalStars пересчитывается внутри компонента (не доверяем кэшу).
   * Мой сектор первый (0°), остальные по часовой стрелке по убыванию.
   */
  const sectors = useMemo<Sector[]>(() => {
    const total = participants.reduce((sum, participant) => sum + participant.stars, 0)

    if (participants.length === 0 || total <= 0) {
      return []
    }

    const ordered = orderParticipants(participants)

    let angle = 0

    return ordered.map((participant) => {
      const hue = hueOf(participant.userId)
      const sweep = (participant.stars / total) * 360
      const percent = (participant.stars / total) * 100
      const sector: Sector = {
        userId: participant.userId,
        name: nameOf(participant),
        shortName: shortNameOf(participant),
        stars: participant.stars,
        isMe: participant.isMe,
        start: angle,
        sweep,
        center: angle + sweep / 2,
        color: `hsl(${hue.toFixed(0)} 70% 50%)`,
        stroke: contrastStrokeOf(hue),
        percent,
      }
      angle += sweep
      return sector
    })
  }, [participants])

  const [rotation, setRotation] = useState(0)
  /**
   * Transition включается ТОЛЬКО в момент реального старта (см. двухфазный запуск
   * в эффекте спина). Пока false — колесо стоит без перехода, и его положение
   * гарантированно отрисовано до начала анимации.
   */
  const [landing, setLanding] = useState(false)

  /**
   * БАГ №1: параметры спина фиксируются ОДИН РАЗ при старте анимации.
   * Пока spinRef.current !== null, ни один рендер (polling каждые 400 мс присылает
   * новый массив участников) не пересчитывает угол и не запускает transition заново.
   */
  const spinRef = useRef<SpinState | null>(null)
  const onSpinEndRef = useRef(onSpinEnd)
  const aliveRef = useRef(true)
  /** Запланированный кадр старта анимации. */
  const rafRef = useRef<number | null>(null)
  /** Страховочный таймер завершения спина (если transitionend не придёт). */
  const endTimerRef = useRef<number | null>(null)

  useEffect(() => {
    onSpinEndRef.current = onSpinEnd
  })

  // Живой ли компонент: таймер спина не должен дёргать колбэк после размонтирования.
  // Именно флаг, а не clearTimeout в cleanup эффекта спина: StrictMode в dev
  // «монтирует» компонент дважды и cleanup убил бы единственный таймер анимации.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Участники и победитель нужны только в момент старта спина, поэтому читаем их
  // из ref: если добавить их в зависимости эффекта старта, каждый ответ polling
  // перезапускал бы анимацию (это и было причиной бага №1).
  const spinInputRef = useRef({ participants, winnerId })
  useEffect(() => {
    spinInputRef.current = { participants, winnerId }
  })

  /** Результат раскрывается ровно один раз — когда колесо реально остановилось. */
  const fireSpinEnd = useCallback(() => {
    const spin = spinRef.current
    if (!aliveRef.current || spin === null || spin.fired) {
      return
    }
    spin.fired = true
    onSpinEndRef.current?.()
  }, [])

  /**
   * БАГ №1 + №3: анимация стартует ровно один раз — при переходе в 'spinning'
   * (включая монтирование сразу в этом статусе, как в PvpPage).
   *
   * Запуск ДВУХФАЗНЫЙ, и это принципиально: сначала браузер должен отрисовать кадр
   * с rotate(0) и выключенным transition, и только следующим кадром мы включаем
   * transition и меняем угол. Если поменять угол в том же кадре, в котором колесо
   * впервые попало на экран, браузер не видит изменения стиля: transition не
   * стартует и колесо мгновенно прыгает в конечное положение. Снаружи это выглядело
   * как «пишет Крутим, а анимации нет».
   */
  useEffect(() => {
    if (currentStatus !== 'spinning') {
      // Спин не идёт: параметры обнуляем, а колесо возвращаем в исходное положение
      // только для лобби ('idle'/'in_round') — в 'result' оно остаётся на победителе.
      spinRef.current = null
      setLanding(false)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current)
        endTimerRef.current = null
      }
      if (currentStatus === 'idle' || currentStatus === 'in_round') {
        setRotation(0)
      }
      return
    }

    // Уже крутимся: второй раз угол не считаем, transition не перезапускаем.
    if (spinRef.current !== null) {
      return
    }

    const { targetAngle, offset } = computeSpinTarget(
      spinInputRef.current.participants,
      spinInputRef.current.winnerId,
    )
    spinRef.current = { spinId: roundId ?? 'round', targetAngle, offset, fired: false }

    // Страховка ставится СРАЗУ, а не внутри rAF: если кадры не придут (вкладка
    // в фоне), игрок всё равно должен увидеть результат после окончания анимации.
    endTimerRef.current = window.setTimeout(() => {
      endTimerRef.current = null
      fireSpinEnd()
    }, SPIN_DURATION_MS + SPIN_END_FALLBACK_MS)

    // Кадр 1 — тот, в котором колесо уже на экране с rotate(0) и transition: none.
    rafRef.current = requestAnimationFrame(() => {
      // Кадр 2: включаем transition и в том же коммите ставим угол — переход
      // стартует от уже отрисованного rotate(0).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (!aliveRef.current || spinRef.current === null) {
          return
        }
        setLanding(true)
        setRotation(targetAngle)
      })
    })
  }, [currentStatus, roundId, fireSpinEnd])

  /** БАГ №3: колесо докрутилось — только теперь можно раскрывать победителя. */
  const handleRotorTransitionEnd = (event: React.TransitionEvent<SVGGElement>) => {
    if (currentStatus !== 'spinning' || event.target !== event.currentTarget) {
      return
    }
    if (event.propertyName && event.propertyName !== 'transform') {
      return
    }
    fireSpinEnd()
  }

  /**
   * БАГ №3: Пока идёт анимация, победителя НЕ раскрываем:
   * ни подсветки сектора, ни победного заголовка — только в статусе 'result'.
   */
  const revealWinner = currentStatus === 'result' && winnerId !== null
  const winnerSector = revealWinner ? sectors.find((sector) => sector.userId === winnerId) : undefined

  return (
    <div className="pvp-roulette">
      <svg
        className="pvp-roulette__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Колесо на ${sectors.length} участников`}
      >
        <g
          onTransitionEnd={handleRotorTransitionEnd}
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
            // transition живёт только во время реального спина: включается в момент
            // старта (landing) вместе с первым изменением угла.
            transition:
              landing && currentStatus === 'spinning'
                ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.15, 0.7, 0.15, 1)`
                : 'none',
          }}
        >
          {sectors.map((sector) => (
            <path
              key={sector.userId}
              d={sectorPath(sector.start, sector.start + sector.sweep)}
              fill={sector.color}
              stroke={sector.isMe ? sector.stroke : 'rgba(0,0,0,0.22)'}
              strokeWidth={sector.isMe ? 2 : 1}
              opacity={revealWinner && winnerId !== sector.userId ? 0.45 : 1}
            />
          ))}

          {sectors
            .filter((sector) => sector.sweep >= LABEL_MIN_SWEEP_DEG)
            .map((sector) => (
              <text
                key={`label-${sector.userId}`}
                x={CENTER}
                y={CENTER - LABEL_RADIUS}
                transform={`rotate(${sector.center} ${CENTER} ${CENTER})`}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pvp-roulette__label"
              >
                <tspan x={CENTER} dy="-6">
                  {sector.shortName}
                </tspan>
                <tspan x={CENTER} dy="13" className="pvp-roulette__label-sub">
                  {sector.percent.toFixed(1)}%
                </tspan>
              </text>
            ))}
        </g>

        <circle cx={CENTER} cy={CENTER} r={12} fill="var(--tg-theme-bg-color)" />
        <polygon
          points={`${CENTER - 9},0 ${CENTER + 9},0 ${CENTER},20`}
          fill="var(--tg-theme-text-color)"
        />
      </svg>

      {sectors.length > 0 && (
        <div className="pvp-roulette__legend">
          {sectors.map((sector) => (
            <span
              key={`legend-${sector.userId}`}
              className={`pvp-roulette__legend-item ${
                revealWinner && winnerId === sector.userId
                  ? 'pvp-roulette__legend-item--winner'
                  : ''
              }`}
            >
              <span className="pvp-roulette__dot" style={{ backgroundColor: sector.color }} />
              {sector.name} — {sector.stars}⭐ — {sector.percent.toFixed(1)}%
            </span>
          ))}
        </div>
      )}

      {winnerSector && (
        <div className="pvp-roulette__caption inline-flex items-center justify-center gap-1.5">
          <Trophy size={16} className="text-[#FFD700]" />
          {winnerSector.isMe ? 'Победа!' : `Победил ${winnerSector.name}`}
        </div>
      )}
    </div>
  )
}

/**
 * БАГ №1 (пункт 5): React.memo с кастомной функцией сравнения.
 * Пока идёт анимация ('spinning') — компонент заморожен и не перерисовывается.
 */
const PvpRouletteMemo = React.memo(PvpRoulette, (prev, next) => {
  const prevStatus = prev.status ?? (prev.spinning ? 'spinning' : 'in_round')
  const nextStatus = next.status ?? (next.spinning ? 'spinning' : 'in_round')

  if (prevStatus === 'spinning' && nextStatus === 'spinning') {
    return true // заморозить во время спина
  }

  return (
    prevStatus === nextStatus &&
    prev.winnerId === next.winnerId &&
    prev.participants === next.participants &&
    prev.roundId === next.roundId
  )
})

export default PvpRouletteMemo
