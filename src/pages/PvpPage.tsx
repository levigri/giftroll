import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Plus, Star, Swords, Trophy } from 'lucide-react'
import type {
  PvpHistoryEntry,
  PvpJoinResponse,
  PvpParticipantView,
  PvpRoundView,
} from '../api/types'
import { ApiError, pvpAddBet, pvpGetCurrent, pvpGetHistory, pvpJoin } from '../api/client'
import { errorFeedback, getTelegramUser, successFeedback, tapFeedback } from '../telegram'
import BetSlider, { MAX_BET_STARS, MIN_BET_STARS } from '../components/BetSlider'
import PvpRoulette from '../components/PvpRoulette'
import WinnerOverlay from '../components/WinnerOverlay'

type Phase = 'idle' | 'in_round' | 'spinning' | 'result'

export interface PvpPageProps {
  balance: number
  /** Обновляет профиль (баланс в шапке) после входа и после спина. */
  onRefreshMe: () => Promise<void> | void
  /** Мгновенное оптимистичное обновление баланса при ставке или докиде. */
  onBalanceChange?: (newBalance: number) => void
}

/** Синхронизация — только polling, без WebSocket. */
const POLL_INTERVAL_MS = 400
/**
 * Последние полторы секунды раунда опрашиваем чаще: спин на сервере срабатывает ровно
 * на нуле, и результат должен подхватиться сразу. Иначе игрок успевает разглядеть
 * «запускаем колесо», стоящее на месте, — это и выглядело как «пишет Крутим, анимации нет».
 */
const FAST_POLL_INTERVAL_MS = 120
const FAST_POLL_WINDOW_MS = 1500
/** Пауза между остановкой колеса и оверлеем: даём увидеть выпавший сектор. */
const OVERLAY_REVEAL_DELAY_MS = 700
/** Тик обратного отсчёта: 100 мс, чтобы десятые доли шли плавно. */
const TIMER_TICK_MS = 100
/** Длительность раунда на сервере — нужна только для прогресс-полосы. */
const ROUND_DURATION_MS = 10_000
/** Сколько секунд после завершения раунда считаем результат «свежим». */
const FRESH_RESULT_MS = 30_000
const DEFAULT_BET_STARS = 500
/** Дефолт формы докида. */
const DEFAULT_ADD_STARS = 100
/** Рейк кассы — 5% от ставок проигравших (зеркалит RAKE_RATE на сервере). */
const RAKE_RATE = 0.05
/** Вне Telegram фронт ходит под этим id (см. authHeaders). */
const DEV_USER_ID = '11111111'
/** Страховка на случай, когда оверлея победителя нет (игра не состоялась). */
const RESULT_FALLBACK_CLOSE_MS = 5000
/** id оптимистичного placeholder-раунда, пока сервер не подтвердил вход. */
const PENDING_ROUND_ID = 'pending'

/** Итог раунда, собранный либо из состояния лобби, либо из истории. */
interface RoundResult {
  id: string
  totalStars: number
  winnerId: string | null
  winnerName: string | null
  rakeStars: number
  participants: PvpParticipantView[]
  myStars: number
  iWon: boolean
  payoutStars: number
  /** Игра не состоялась — ставка возвращена. */
  refunded: boolean
}

function nameOf(participant: PvpParticipantView): string {
  if (participant.isMe && !participant.username) {
    // Оптимистичный placeholder: своё имя сервер ещё не прислал.
    return 'Ты'
  }
  const base = participant.username ?? (participant.isBot ? 'Test Bot' : 'Игрок')
  return participant.isMe ? `${base} (ты)` : base
}

/** «33.3%» — процент от банка, он же шанс победы. */
function percentOf(stars: number, totalStars: number): string {
  if (totalStars <= 0) {
    return '0.0'
  }
  return ((stars / totalStars) * 100).toFixed(1)
}

/**
 * Моя выплата в раунде: своя ставка + 95% от суммы ставок проигравших —
 * та же формула, что и в performSpin на сервере.
 * Проиграл или победил бот — выплаты нет.
 */
function calculateMyPayout(round: RoundResult, myUserId: string): number {
  const me =
    round.participants.find((participant) => participant.isMe) ??
    round.participants.find((participant) => participant.userId === myUserId)

  if (!me || round.winnerId === null || round.winnerId !== me.userId) {
    return 0
  }

  const loserPool = Math.max(0, round.totalStars - me.stars)
  // Комиссия приходит с сервера — это авторитетное значение; формула — запасной вариант.
  const rake = round.rakeStars > 0 ? round.rakeStars : Math.round(loserPool * RAKE_RATE)
  return me.stars + loserPool - rake
}

/** Список участников: ник · ставка ⭐ · процент. Победитель подсвечивается зелёным. */
function ParticipantRows({
  participants,
  totalStars,
  winnerId = null,
}: {
  participants: PvpParticipantView[]
  totalStars: number
  winnerId?: string | null
}) {
  return (
    <div className="pvp__players">
      {participants.map((participant) => (
        <div
          key={participant.userId}
          className={`pvp__player ${participant.isMe ? 'pvp__player--me' : ''} ${
            winnerId !== null && winnerId === participant.userId ? 'pvp__player--winner' : ''
          }`}
        >
          <span className="pvp__player-name">{nameOf(participant)}</span>
          <span className="pvp__player-stars inline-flex items-center gap-0.5">
            {participant.stars}
            <Star size={10} fill="currentColor" />
          </span>
          <span className="pvp__player-chance">{percentOf(participant.stars, totalStars)}%</span>
        </div>
      ))}
    </div>
  )
}

/** Оптимистичный раунд на время входа: себя показываем, не дожидаясь сервера. */
function optimisticRound(stars: number): PvpRoundView {
  return {
    id: PENDING_ROUND_ID,
    status: 'open',
    totalStars: stars,
    endsAt: null,
    participants: [{ userId: 'me', username: null, stars, isBot: false, isMe: true, chance: 1 }],
    winnerId: null,
    winnerName: null,
    rakeStars: 0,
    finishedAt: null,
  }
}

/** Оптимистичный докид: своя ставка и банк растут до ответа сервера. */
function withExtraBet(round: PvpRoundView, extra: number): PvpRoundView {
  const participants = round.participants.map((participant) =>
    participant.isMe ? { ...participant, stars: participant.stars + extra } : participant,
  )
  const totalStars = participants.reduce((sum, participant) => sum + participant.stars, 0)

  return {
    ...round,
    totalStars,
    participants: participants.map((participant) => ({
      ...participant,
      chance: totalStars > 0 ? participant.stars / totalStars : 0,
    })),
  }
}

function resultFromRound(round: PvpRoundView): RoundResult {
  const mine = round.participants.find((participant) => participant.isMe)
  const iWon = round.winnerId !== null && mine?.userId === round.winnerId
  const totalPayout = round.totalStars - round.rakeStars

  return {
    id: round.id,
    totalStars: round.totalStars,
    winnerId: round.winnerId,
    winnerName: round.winnerName,
    rakeStars: round.rakeStars,
    participants: round.participants,
    myStars: mine?.stars ?? 0,
    iWon,
    payoutStars: totalPayout,
    refunded: round.winnerId === null,
  }
}

function resultFromHistory(entry: PvpHistoryEntry): RoundResult {
  return {
    id: entry.id,
    totalStars: entry.totalStars,
    winnerId: entry.winnerId,
    winnerName: entry.winnerName,
    rakeStars: entry.rakeStars,
    participants: entry.participants,
    myStars: entry.myStars,
    iWon: entry.iWon,
    payoutStars: entry.payoutStars,
    refunded: entry.winnerId === null,
  }
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INSUFFICIENT_FUNDS':
        return 'Недостаточно средств'
      case 'INVALID_BET':
        return `Ставка должна быть от ${MIN_BET_STARS} до ${MAX_BET_STARS} ⭐`
      case 'ALREADY_JOINED':
        return 'Ты уже участвуешь в этом раунде'
      case 'NOT_IN_ROUND':
        return 'Ты не участвуешь в этом раунде'
      case 'ROUND_CLOSED':
        return 'Ставки в этом раунде уже закрыты'
      case 'ROUND_NOT_FOUND':
        return 'Раунд больше недоступен'
      case 'VALIDATION_ERROR':
        return 'Проверь ставку и попробуй ещё раз'
      default:
        return err.message
    }
  }
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

function formatTime(iso: string | null): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString(
    'ru-RU',
    { hour: '2-digit', minute: '2-digit' },
  )}`
}

export default function PvpPage({ balance, onRefreshMe, onBalanceChange }: PvpPageProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [round, setRound] = useState<PvpRoundView | null>(null)
  const [result, setResult] = useState<RoundResult | null>(null)
  const [history, setHistory] = useState<PvpHistoryEntry[]>([])
  const [stars, setStars] = useState(() =>
    Math.min(DEFAULT_BET_STARS, Math.max(MIN_BET_STARS, balance)),
  )
  /** Дополнительная ставка формы «Докинуть» (Баг 3). */
  const [additionalBet, setAdditionalBet] = useState(DEFAULT_ADD_STARS)
  /** id раунда от сервера: без него pvpAddBet вызвать нечем. */
  const [roundId, setRoundId] = useState<string | null>(null)
  /** Идёт вход: UI уже в 'in_round', ответ pvpJoin ещё в пути. */
  const [joining, setJoining] = useState(false)
  const [showAddBet, setShowAddBet] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  /** Оверлей победителя показан (появляется с задержкой после остановки колеса). */
  const [overlayReady, setOverlayReady] = useState(false)

  // Текущая фаза нужна внутри polling-колбэка без пересоздания интервала.
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Пока вход не подтверждён, ответы polling без меня игнорируем: сервер
  // просто ещё не знает о моей ставке.
  const joiningRef = useRef(false)
  // Polling ref (Баг №2): остановка при spinning и result
  const pollRef = useRef<number | null>(null)
  // Защита от затирания докида устаревшим ответом поллинга
  const optimisticStarsRef = useRef<number | null>(null)
  // Защита от повторного запуска спина одного и того же завершённого раунда
  const lastSeenFinishedRoundIdRef = useRef<string | null>(null)
  /**
   * Момент конца текущего раунда в мс: нужен polling-циклу, чтобы перейти на частый
   * опрос на последних секундах. Именно ref, чтобы интервал не пересоздавался.
   */
  const roundEndsAtRef = useRef<number | null>(null)
  /** Блок с колесом — при старте спина его прокручиваем в зону видимости. */
  const outcomeRef = useRef<HTMLDivElement | null>(null)

  const showError = useCallback((err: unknown) => {
    const text = formatErrorMessage(err)
    setError(text)
    setTimeout(() => {
      setError((current) => (current === text ? null : current))
    }, 3500)
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await pvpGetHistory()
      setHistory(res)
    } catch (err: unknown) {
      console.error('[PVP] pvpGetHistory failed:', err)
      showError(err)
    }
  }, [showError])

  /** Свой раунд закончился, а нового в лобби нет — берём результат из истории. */
  const finishFromHistory = useCallback(async () => {
    try {
      const res = await pvpGetHistory()
      const latest = res[0]
      if (latest?.finishedAt && Date.now() - Date.parse(latest.finishedAt) < FRESH_RESULT_MS) {
        // Историю обновим после спина: иначе победитель виден в «Последних играх»
        // ещё пока крутится колесо, и интрига пропадает.
        if (lastSeenFinishedRoundIdRef.current !== latest.id) {
          lastSeenFinishedRoundIdRef.current = latest.id
          setResult(resultFromHistory(latest))
          setPhase('spinning')
          return
        }
      }
      setHistory(res)
    } catch (err: unknown) {
      console.error('[PVP] не удалось прочитать историю для результата:', err)
      showError(err)
    }

    setRound(null)
    setPhase('idle')
  }, [showError])

  /** Применяет снимок лобби: вход в раунд, докид и завершение (Баг №3). */
  const applyRound = useCallback(
    (next: PvpRoundView | null) => {
      if (next === null) {
        // Пока вход не подтверждён, пустой ответ значит «ставка ещё не применена»,
        // а не «раунд закончился».
        if (phaseRef.current === 'in_round' && !joiningRef.current) {
          void finishFromHistory()
        }
        return
      }

      // Если раунд завершён — крутим колесо и показываем результат (Баг №3).
      if (next.status === 'finished') {
        if (lastSeenFinishedRoundIdRef.current === next.id) {
          return
        }
        lastSeenFinishedRoundIdRef.current = next.id

        // Чужой раунд: я в нём не ставил — спин и оверлей победителя ни к чему,
        // в лобби просто обновляем историю.
        if (!next.participants.some((participant) => participant.isMe)) {
          void loadHistory()
          setRound(null)
          setPhase('idle')
          return
        }

        setRoundId(null)
        setResult(resultFromRound(next))
        setPhase('spinning')
        return
      }

      // Если есть оптимистичный докид — защищаем его от затирания устаревшим поллингом:
      if (optimisticStarsRef.current !== null) {
        const myParticipant = next.participants.find((participant) => participant.isMe)
        if (myParticipant && myParticipant.stars < optimisticStarsRef.current) {
          const diff = optimisticStarsRef.current - myParticipant.stars
          next = withExtraBet(next, diff)
        } else if (myParticipant && myParticipant.stars >= optimisticStarsRef.current) {
          optimisticStarsRef.current = null
        }
      }

      const meInRound = next.participants.some((participant) => participant.isMe)

      if (meInRound) {
        setRoundId(next.id)
      }

      if (phaseRef.current === 'in_round' && !meInRound) {
        if (joiningRef.current) {
          return
        }
        void finishFromHistory()
        return
      }

      // Открытое лобби показываем, чтобы можно было в него войти или следить.
      setRound(next)
      if (meInRound) {
        setPhase('in_round')
      }
    },
    [finishFromHistory, loadHistory],
  )

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // Колбэки держим в ref: polling не должен переподписываться на каждом рендере —
  // лишние teardown/setup теряют запросы и дают лаг при старте.
  const applyRoundRef = useRef(applyRound)
  const showErrorRef = useRef(showError)
  useEffect(() => {
    applyRoundRef.current = applyRound
    showErrorRef.current = showError
  })

  /**
   * Polling лобби (Баг №2):
   * Полностью останавливается при spinning и result, чтобы не провоцировать ререндеры.
   * Первый запрос уходит сразу при монтировании и при возврате в idle/in_round, дальше —
   * цепочка setTimeout: в лобби интервал 400 мс, но на последних секундах раунда — 120 мс,
   * чтобы результат спина подхватился сразу после нуля, а не через полсекунды.
   */
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'in_round') {
      if (pollRef.current !== null) {
        clearTimeout(pollRef.current)
        pollRef.current = null
      }
      return
    }

    let cancelled = false
    let timer: number | null = null

    // Спин уже идёт: ответы устаревших запросов не должны менять стейт.
    // Через функцию, а не через сравнение напрямую: так сужение типов не «залипает».
    const spinBusy = () => phaseRef.current === 'spinning' || phaseRef.current === 'result'

    const tick = async () => {
      if (spinBusy()) {
        return
      }
      try {
        const data = await pvpGetCurrent()
        if (!cancelled && !spinBusy()) {
          applyRoundRef.current(data.round)
        }
      } catch (err: unknown) {
        console.error('[PVP] pvpGetCurrent failed:', err)
        if (!cancelled && !spinBusy()) {
          showErrorRef.current(err)
        }
      }
    }

    /** Пауза до следующего опроса: у самого нуля раунда — короткая. */
    const nextDelay = () => {
      const endsAt = roundEndsAtRef.current
      if (endsAt === null) {
        return POLL_INTERVAL_MS
      }
      return endsAt - Date.now() <= FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    }

    const loop = async () => {
      await tick()
      if (cancelled || spinBusy()) {
        return
      }
      timer = window.setTimeout(() => void loop(), nextDelay())
      pollRef.current = timer
    }

    // Первый запрос — немедленно, БЕЗ ожидания первого интервала.
    void loop()

    return () => {
      cancelled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      if (pollRef.current === timer) {
        pollRef.current = null
      }
    }
  }, [phase])

  /** Момент конца раунда для polling-цикла (см. nextDelay). */
  useEffect(() => {
    roundEndsAtRef.current = round?.endsAt ? Date.parse(round.endsAt) : null
  }, [round])

  /**
   * Спин стартует — колесо обязано быть на экране: иначе анимация проходит «за кадром»,
   * и игрок видит только надпись и уже готовый результат.
   */
  useEffect(() => {
    if (phase !== 'spinning') {
      return
    }
    outcomeRef.current?.scrollIntoView({ block: 'center' })
  }, [phase])

  /** Тик таймера лобби: 100 мс, чтобы десятые доли шли плавно. */
  useEffect(() => {
    if (phase !== 'in_round' && !(phase === 'idle' && round !== null)) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TIMER_TICK_MS)
    return () => clearInterval(timer)
  }, [phase, round])

  // Данные для полноэкранного оверлея победителя.
  // Telegram SDK дёргаем один раз: объект юзера не должен меняться на каждом рендере.
  const tgUser = useMemo(() => getTelegramUser(), [])
  /** Мой id для сравнения с победителем: в dev — фиксированный Telegram id. */
  const myUserId = String(tgUser?.id ?? DEV_USER_ID)

  /**
   * Баг №3: анимация колеса закончилась — только теперь раскрываем победителя
   * и показываем оверлей. Локальный результат приоритетнее (он собран из того же
   * раунда, что крутили); сеть дёргаем только если результата нет — например,
   * страницу открыли уже во время спина.
   */
  const handleSpinEnd = useCallback(async () => {
    let finalResult: RoundResult | null = result

    if (finalResult === null) {
      try {
        const data = await pvpGetCurrent()
        if (data.round?.status === 'finished' && data.round.winnerId) {
          finalResult = resultFromRound(data.round)
          setResult(finalResult)
        }
      } catch (err: unknown) {
        console.error('[PVP] не удалось подтвердить результат после спина:', err)
      }
    }

    if (finalResult === null) {
      // Раунд завершился без победителя и без истории — возвращаемся в лобби.
      setPhase('idle')
      return
    }

    if (finalResult.refunded) {
      tapFeedback('light')
    } else if (finalResult.iWon) {
      successFeedback()
    } else {
      errorFeedback()
    }

    // Звёзды начисляем ровно в момент остановки колеса: до окончания анимации баланс
    // не трогаем вообще, хотя сервер уже посчитал раунд в момент спина. Сверка с
    // сервером (onRefreshMe) идёт сразу после — уже по факту раскрытия результата.
    let settledBalance = balance
    if (finalResult.refunded) {
      settledBalance = balance + finalResult.myStars
    } else if (finalResult.iWon) {
      settledBalance = balance + calculateMyPayout(finalResult, myUserId)
    }
    if (settledBalance !== balance) {
      onBalanceChange?.(settledBalance)
    }

    setPhase('result')
    void onRefreshMe()
    void loadHistory()
  }, [result, myUserId, balance, onBalanceChange, onRefreshMe, loadHistory])

  /**
   * Вход в игру: UI переключается мгновенно, баланс списывается сразу,
   * а ответ pvpJoin напрямую применяется без ожидания второго pvpGetCurrent.
   */
  const handleJoin = () => {
    if (stars > balance) {
      errorFeedback()
      showError(new ApiError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400))
      return
    }

    tapFeedback('medium')
    setShowAddBet(false)
    setAdditionalBet(Math.min(DEFAULT_ADD_STARS, Math.max(MIN_BET_STARS, stars)))

    // Мгновенное списание баланса (0 мс задержки)
    onBalanceChange?.(Math.max(0, balance - stars))

    // Сразу показываем себя в лобби
    setRound(optimisticRound(stars))
    setRoundId(null)
    setPhase('in_round')
    joiningRef.current = true
    setJoining(true)

    void (async () => {
      let joinRes: PvpJoinResponse
      try {
        joinRes = await pvpJoin(stars)
        setRoundId(joinRes.roundId)
      } catch (err: unknown) {
        console.error('[PVP] pvpJoin failed:', err)
        onBalanceChange?.(balance)
        joiningRef.current = false
        setJoining(false)
        setRoundId(null)
        setRound(null)
        setPhase('idle')
        errorFeedback()
        showError(err)
        return
      }

      joiningRef.current = false
      setJoining(false)

      if (joinRes.round) {
        applyRound(joinRes.round)
      } else {
        try {
          const data = await pvpGetCurrent()
          if (data.round) {
            applyRound(data.round)
          } else {
            await finishFromHistory()
          }
        } catch (err: unknown) {
          console.error('[PVP] не удалось перечитать раунд после входа:', err)
          showError(err)
        }
      }

      void onRefreshMe()
    })()
  }

  /**
   * Докид: мгновенное списание баланса, защита ставки от затирания поллингом,
   * и прямое применение ответа pvpAddBet.
   */
  const handleAddBet = () => {
    if (!round || roundId === null) {
      console.error('[PVP] докид недоступен: нет roundId', { round, roundId })
      showError(new ApiError('ROUND_NOT_FOUND', 'Раунд ещё не подтверждён сервером', 409))
      return
    }

    if (additionalBet < MIN_BET_STARS) {
      errorFeedback()
      showError(new ApiError('INVALID_BET', `Минимальная добавка ${MIN_BET_STARS} ⭐`, 400))
      return
    }

    if (additionalBet > balance) {
      errorFeedback()
      showError(new ApiError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400))
      return
    }

    const targetRoundId = roundId
    const bet = additionalBet
    const snapshot = round

    tapFeedback('medium')
    setShowAddBet(false)

    // Мгновенное списание баланса (0 мс задержки)
    onBalanceChange?.(Math.max(0, balance - bet))

    // Запоминаем ожидаемую ставку для защиты от затирания поллингом
    const currentMyStars = round.participants.find((p) => p.isMe)?.stars ?? 0
    optimisticStarsRef.current = currentMyStars + bet

    setRound(withExtraBet(round, bet))

    void (async () => {
      let addRes: { ok: boolean; round?: PvpRoundView }
      try {
        addRes = await pvpAddBet(targetRoundId, bet)
      } catch (err: unknown) {
        console.error('[PVP] pvpAddBet failed:', err)
        onBalanceChange?.(balance)
        optimisticStarsRef.current = null
        try {
          const data = await pvpGetCurrent()
          setRound(data.round ?? snapshot)
        } catch (refetchError: unknown) {
          console.error('[PVP] не удалось перечитать раунд после отката:', refetchError)
          setRound(snapshot)
        }
        setShowAddBet(true)
        errorFeedback()
        showError(err)
        return
      }

      optimisticStarsRef.current = null

      if (addRes.round) {
        setRound(addRes.round)
      } else {
        try {
          const data = await pvpGetCurrent()
          if (data.round) {
            setRound(data.round)
          }
        } catch (err: unknown) {
          console.error('[PVP] не удалось перечитать раунд после докида:', err)
        }
      }

      void onRefreshMe()
    })()
  }

  /**
   * «Играть ещё»: закрыть оверлей, сбросить раунд и вернуться в лобби.
   * Polling возобновляется сам — его эффект зависит от phase.
   */
  const handlePlayAgain = useCallback(() => {
    tapFeedback('light')
    setPhase('idle')
    setResult(null)
    setRound(null)
    setRoundId(null)
    setShowAddBet(false)
    setOverlayReady(false)
    // Ставку возвращаем к дефолту, но не выше доступного баланса.
    setStars(Math.min(DEFAULT_BET_STARS, Math.max(MIN_BET_STARS, balance)))
    void loadHistory()
    void onRefreshMe()
  }, [balance, loadHistory, onRefreshMe])

  const myStars = round?.participants.find((participant) => participant.isMe)?.stars ?? 0
  // endsAt === null — в раунде пока один участник, отсчёт ещё не начался.
  const endsAtMs = round?.endsAt ? Date.parse(round.endsAt) : null
  const msLeft = endsAtMs === null ? null : Math.max(0, endsAtMs - now)
  const secondsLeft = msLeft === null ? null : msLeft / 1000
  const spinningSoon = msLeft !== null && msLeft <= 0
  const progress = msLeft === null ? 0 : Math.min(1, Math.max(0, 1 - msLeft / ROUND_DURATION_MS))
  /** Больше баланса поставить нельзя — этим ограничены оба слайдера. */
  const maxBet = Math.min(MAX_BET_STARS, Math.max(MIN_BET_STARS, balance))
  /** В раунде пока один участник: либо вхожу я, либо жду живого соперника. */
  const waitingForOpponent = joining || (round !== null && round.participants.length < 2)

  // Данные для полноэкранного оверлея победителя.
  const winnerParticipant =
    result?.winnerId != null
      ? (result.participants.find((p) => p.userId === result.winnerId) ?? null)
      : null
  const myPayout = result ? calculateMyPayout(result, myUserId) : 0
  /** Оверлей показываем только когда есть победитель: раунд без соперника — текстом. */
  const hasWinner = result !== null && !result.refunded && winnerParticipant !== null
  /**
   * Оверлей появляется с короткой задержкой после остановки колеса: игрок должен успеть
   * увидеть, что выпал именно сектор победителя, а не только карточку поверх всего.
   */
  const showWinnerOverlay = phase === 'result' && overlayReady && hasWinner

  /** Задержка перед оверлеем: колесо стоит на победителе, результат уже виден. */
  useEffect(() => {
    if (phase !== 'result' || !hasWinner) {
      setOverlayReady(false)
      return
    }

    const timer = window.setTimeout(() => setOverlayReady(true), OVERLAY_REVEAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, hasWinner])

  /**
   * Страховка: если оверлея не будет вовсе (игра не состоялась) — страница сама
   * возвращается в 'idle'. В обычном случае оверлей закрывается своим таймером (5 сек).
   */
  useEffect(() => {
    if (phase !== 'result' || hasWinner) {
      return
    }

    const timer = setTimeout(handlePlayAgain, RESULT_FALLBACK_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [phase, hasWinner, handlePlayAgain])

  return (
    <div className="pvp">
      <h2 className="pvp__title inline-flex items-center gap-2">
        <Swords size={20} className="text-[#8A2BE2]" />
        Рулетка на толпу
      </h2>
      <p className="pvp__subtitle">
        Ставь звёзды против всех сразу. Через 10 секунд после входа второго участника колесо выбирает
        одного победителя: он получает свою ставку и 95% от суммы ставок проигравших. Больше
        ставишь — выше шанс.
      </p>

      {error && <div className="pvp__error">{error}</div>}

      {phase === 'idle' && (
        <>
          {round && (
            <section className="pvp__lobby">
              <div className="pvp__lobby-head">
                <span className="pvp__lobby-title">Сейчас играют</span>
                <span className="pvp__bank inline-flex items-center gap-0.5">
                  Банк: {round.totalStars}
                  <Star size={11} fill="currentColor" />
                </span>
              </div>
              <div className="pvp__wheel-box">
                <PvpRoulette
                  participants={round.participants}
                  winnerId={null}
                  status="in_round"
                  roundId={round.id}
                />
              </div>
              <ParticipantRows participants={round.participants} totalStars={round.totalStars} />
              <div className="pvp__lobby-hint">
                {msLeft === null
                  ? 'Раунд ждёт второго игрока — успей войти'
                  : `Раунд закроется через ${Math.max(0, Math.ceil(msLeft / 1000))} сек — успей войти`}
              </div>
            </section>
          )}

          <BetSlider value={stars} onChange={setStars} balance={balance} max={maxBet} />

          <button
            type="button"
            className="gold-btn flex items-center justify-center gap-1.5 py-3.5 text-base"
            onClick={handleJoin}
            disabled={stars > balance}
          >
            <Swords size={17} />
            Войти в игру · {stars}
            <Star size={14} fill="currentColor" />
          </button>
        </>
      )}

      {phase === 'in_round' && round && (
        <>
          <div className="pvp__timer">
            {msLeft === null ? (
              <span className="pvp__timer-text inline-flex items-center justify-center gap-1.5">
                <Clock size={13} />
                Спин ждёт второго участника
              </span>
            ) : spinningSoon ? (
              <span className="pvp__timer-text pvp__timer-text--spin">
                Ставки закрыты · запускаем колесо…
              </span>
            ) : (
              <span className="pvp__timer-text">
                Спин через {(secondsLeft ?? 0).toFixed(1)} сек...
              </span>
            )}

            {msLeft !== null && (
              <div className="pvp__timer-track">
                <div className="pvp__timer-fill" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>

          <div className="pvp__wheel-box">
            <PvpRoulette
              participants={round.participants}
              winnerId={null}
              status="in_round"
              roundId={round.id}
            />
          </div>

          <section className="pvp__lobby">
            <div className="pvp__lobby-head">
              <span className="pvp__lobby-title">Игра идёт</span>
              <span className="pvp__bank inline-flex items-center gap-0.5">
                Банк: {round.totalStars}
                <Star size={11} fill="currentColor" />
              </span>
            </div>

            <ParticipantRows participants={round.participants} totalStars={round.totalStars} />

            {waitingForOpponent && (
              <div className="pvp__player pvp__player--waiting">Ищем соперника...</div>
            )}

            <div className="pvp__lobby-hint">
              Твоя ставка: {myStars} ⭐ · шанс {percentOf(myStars, round.totalStars)}%
            </div>

            {balance < MIN_BET_STARS ? (
              <div className="pvp__lobby-hint">
                Недостаточно ⭐, чтобы докинуть: минимальная добавка {MIN_BET_STARS} ⭐
              </div>
            ) : showAddBet ? (
              <div className="pvp__addbet">
                <BetSlider
                  compact
                  label="Докинуть"
                  value={additionalBet}
                  onChange={setAdditionalBet}
                  balance={balance}
                  max={maxBet}
                />
                <div className="pvp__addbet-actions">
                  <button
                    type="button"
                    className="gold-btn py-2.5 text-sm"
                    onClick={handleAddBet}
                    disabled={roundId === null || additionalBet > balance}
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    className="ghost-btn py-2.5 text-sm"
                    onClick={() => {
                      tapFeedback('light')
                      setShowAddBet(false)
                    }}
                  >
                    Отмена
                  </button>
                </div>
                {roundId === null && (
                  <div className="pvp__lobby-hint">Ждём подтверждения входа от сервера...</div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="ghost-btn flex items-center justify-center gap-1.5 py-3 text-sm"
                onClick={() => {
                  tapFeedback('light')
                  setAdditionalBet(Math.min(DEFAULT_ADD_STARS, maxBet))
                  setShowAddBet(true)
                }}
                disabled={roundId === null}
              >
                <Plus size={15} className="text-[#c084fc]" />
                Докинуть ставку
              </button>
            )}
          </section>
        </>
      )}

      {/*
        Баг №1–№4: в 'spinning' и 'result' рендерится ОДИН и тот же инстанс колеса
        (один слот в дереве), поэтому анимация не перезапускается, а после остановки
        колесо остаётся на выпавшем секторе. Победителя раскрывает только status='result'.
      */}
      {result && (phase === 'spinning' || phase === 'result') && (
        <div className="pvp__outcome" ref={outcomeRef}>
          <PvpRoulette
            participants={result.participants}
            winnerId={result.winnerId}
            status={phase}
            roundId={result.id}
            onSpinEnd={phase === 'spinning' ? handleSpinEnd : undefined}
          />

          <div className="pvp__status">
            {phase === 'spinning' ? 'Колесо крутится…' : 'Колесо остановилось'}
          </div>

          {/* Победитель появляется ТОЛЬКО после остановки колеса (Баг №3). */}
          {phase === 'result' && !result.refunded && (
            <div
              className={`pvp__result-line ${
                result.iWon ? 'pvp__result-line--win' : 'pvp__result-line--lose'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Trophy size={16} />
                {result.iWon
                  ? `Победа! Твой сектор выпал: +${myPayout - result.myStars}`
                  : `Победил ${
                      winnerParticipant?.isBot
                        ? 'Test Bot'
                        : (winnerParticipant?.username ?? 'соперник')
                    }`}
                <Star size={13} fill="currentColor" />
              </span>
            </div>
          )}

          <ParticipantRows
            participants={result.participants}
            totalStars={result.totalStars}
            winnerId={phase === 'result' ? result.winnerId : null}
          />
        </div>
      )}

      {/* Полноэкранный оверлей победителя: рисуется ПОВЕРХ колеса, без размонтирования. */}
      {showWinnerOverlay && result && winnerParticipant && (
        <WinnerOverlay
          winner={{
            userId: winnerParticipant.userId,
            username: winnerParticipant.username ?? 'Игрок',
            stars: winnerParticipant.stars,
            isBot: winnerParticipant.isBot,
          }}
          totalStars={result.totalStars}
          myUserId={myUserId}
          myPayout={myPayout}
          myBet={result.myStars}
          onClose={handlePlayAgain}
        />
      )}

      {phase === 'result' && result?.refunded && (
        <div className="pvp__outcome">
          <div className="pvp__status">Игра не состоялась — ставка возвращена</div>
        </div>
      )}

      <section className="pvp__history">
        <h3 className="pvp__history-title">Последние игры</h3>

        {history.length === 0 ? (
          <div className="pvp__history-empty">Ты ещё не играл в рулетку на толпу</div>
        ) : (
          <div className="pvp__history-list">
            {history.map((entry) => (
              <div key={entry.id} className="pvp__history-item">
                <div className="pvp__history-main">
                  <div className="pvp__history-opponent inline-flex items-center gap-0.5">
                    Банк {entry.totalStars}
                    <Star size={10} fill="currentColor" /> · {entry.participants.length} участн.
                  </div>
                  <div className="pvp__history-meta">{formatTime(entry.finishedAt)}</div>
                </div>

                {entry.winnerId === null ? (
                  <span className="pvp__history-result pvp__history-result--lose">
                    не состоялась
                  </span>
                ) : entry.iWon ? (
                  <span className="pvp__history-result pvp__history-result--win inline-flex items-center gap-0.5">
                    +{entry.payoutStars}
                    <Star size={10} fill="currentColor" />
                  </span>
                ) : (
                  <span className="pvp__history-result pvp__history-result--lose inline-flex items-center gap-0.5">
                    −{entry.myStars}
                    <Star size={10} fill="currentColor" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
