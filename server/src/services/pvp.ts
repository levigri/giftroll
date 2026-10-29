import type { Prisma, PvpParticipant, PvpRound } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { GameError } from './game.js'
import { processWagering } from './deposit.js'
import { logTransaction } from './transaction.js'

/** Границы ставки в звёздах. */
export const MIN_BET_STARS = 10
export const MAX_BET_STARS = 100000

/** Комиссия кассы — 5% от суммы ставок всех проигравших. */
export const RAKE_RATE = 0.05

/** Лобби живёт 10 секунд с момента входа второго участника, затем спин. */
export const ROUND_DURATION_MS = 10_000

/**
 * ⚠️ DEV ONLY: Telegram ID дев-пользователя, которому автоматически подсаживается бот.
 * Перед релизом удалить вместе с блоком в joinRound.
 */
export const DEV_TELEGRAM_ID = 11111111n

/** ⚠️ DEV ONLY: виртуальный игрок. Баланс бота нигде не хранится. */
export const BOT_USER_ID = 99999999n
export const BOT_NAME = '🤖 Test Bot'

/**
 * Advisory-lock на всё лобби: вход, докид и спин строго сериализованы,
 * поэтому двух параллельных раундов или двойной выплаты быть не может.
 */
const LOBBY_LOCK_KEY = 917234561

/** Спин, потерявший таймер (перезапуск/crash), добивается после этой задержки. */
const STALE_SPIN_MS = 15_000

export type PvpRoundStatus = 'open' | 'spinning' | 'finished'

export interface PvpParticipantView {
  userId: string
  username: string | null
  stars: number
  isBot: boolean
  isMe: boolean
  /** Шанс победы: stars / totalStars. */
  chance: number
}

export interface PvpRoundView {
  id: string
  status: PvpRoundStatus
  totalStars: number
  /** null — раунд ждёт второго участника, отсчёт ещё не идёт. */
  endsAt: string | null
  participants: PvpParticipantView[]
  winnerId: string | null
  winnerName: string | null
  rakeStars: number
  finishedAt: string | null
}

export interface PvpJoinResult {
  roundId: string
  endsAt: string | null
  round: PvpRoundView
}

export interface PvpHistoryEntry {
  id: string
  status: PvpRoundStatus
  totalStars: number
  winnerId: string | null
  winnerName: string | null
  rakeStars: number
  finishedAt: string | null
  participants: PvpParticipantView[]
  myStars: number
  iWon: boolean
  payoutStars: number
}

export interface PvpSpinResult {
  roundId: string
  winnerId: string | null
  winnerName: string | null
  payoutStars: number
  rakeStars: number
  totalStars: number
  /** Игра не состоялась (участник остался один) — ставки возвращены. */
  refunded: boolean
}

/** Таймеры спинов по раундам: один активный таймер на раунд. */
const spinTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Момент спина: null, пока в раунде нет второго участника. */
function roundEndsAt(startedAt: Date | null): Date | null {
  return startedAt ? new Date(startedAt.getTime() + ROUND_DURATION_MS) : null
}

function scheduleSpin(roundId: string, endsAt: Date | null): void {
  if (!endsAt || spinTimers.has(roundId)) {
    return
  }

  const delay = Math.max(0, endsAt.getTime() - Date.now())
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    spinTimers.delete(roundId)
    void performSpin(roundId).catch((error: unknown) => {
      console.error(`[PVP] spin failed for round=${roundId}:`, error)
    })
  }, delay)

  // Таймер не должен удерживать процесс при остановке сервера.
  timer.unref?.()
  spinTimers.set(roundId, timer)
}

/**
 * Восстанавливает прогресс раунда после перезапуска сервера:
 * потерянный таймер перепланируется, «зависший» спин досчитывается.
 */
async function ensureRoundProgress(round: PvpRound): Promise<void> {
  const endsAt = roundEndsAt(round.startedAt)
  const now = Date.now()

  if (round.status === 'open') {
    // Раунд ждёт второго участника: таймер ещё не идёт, планировать нечего.
    if (!endsAt) {
      return
    }
    if (spinTimers.has(round.id)) {
      return
    }
    if (now >= endsAt.getTime()) {
      void performSpin(round.id).catch((error: unknown) => {
        console.error(`[PVP] late spin failed for round=${round.id}:`, error)
      })
      return
    }
    scheduleSpin(round.id, endsAt)
    return
  }

  // Раунд остался в 'spinning' после падения процесса — доводим до конца.
  if (endsAt && now - endsAt.getTime() > STALE_SPIN_MS && !spinTimers.has(round.id)) {
    void performSpin(round.id).catch((error: unknown) => {
      console.error(`[PVP] recovery spin failed for round=${round.id}:`, error)
    })
  }
}

async function lockLobby(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOBBY_LOCK_KEY}) IS NULL AS locked`
}

function assertStars(stars: number): void {
  if (!Number.isInteger(stars) || stars < MIN_BET_STARS || stars > MAX_BET_STARS) {
    throw new GameError(
      'INVALID_BET',
      `Ставка должна быть целым числом от ${MIN_BET_STARS} до ${MAX_BET_STARS} ⭐`,
      400,
    )
  }
}

/** Порядок участников в списках и на колесе: люди по времени входа, бот в конце. */
function sortParticipants(participants: PvpParticipant[]): PvpParticipant[] {
  return [...participants].sort((a, b) => {
    if (a.isBot !== b.isBot) {
      return a.isBot ? 1 : -1
    }
    return a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id)
  })
}

/** Отображаемое имя участника для лобби. */
export function displayName(user: { firstName: string; username: string | null }): string {
  return user.username ? `@${user.username}` : user.firstName
}

function viewOf(
  participants: PvpParticipant[],
  totalStars: number,
  viewerId: bigint,
): PvpParticipantView[] {
  return sortParticipants(participants).map((participant) => ({
    userId: participant.userId.toString(),
    username: participant.username,
    stars: participant.stars,
    isBot: participant.isBot,
    isMe: participant.userId === viewerId,
    chance: totalStars > 0 ? participant.stars / totalStars : 0,
  }))
}

function sumStars(participants: PvpParticipant[]): number {
  return participants.reduce((sum, participant) => sum + participant.stars, 0)
}

function winnerNameOf(participants: PvpParticipant[], winnerId: bigint | null): string | null {
  if (winnerId === null) {
    return null
  }
  const winner = participants.find((participant) => participant.userId === winnerId)
  if (!winner) {
    return null
  }
  return winner.username ?? (winner.isBot ? BOT_NAME : null)
}

async function findActiveRound(): Promise<PvpRound | null> {
  return prisma.pvpRound.findFirst({
    where: { status: { in: ['open', 'spinning'] } },
    orderBy: { createdAt: 'desc' },
  })
}

/** Достраивает снимок раунда для фронтенда (участники + endsAt). */
async function buildRoundView(round: PvpRound, viewerId: bigint): Promise<PvpRoundView> {
  const participants = await prisma.pvpParticipant.findMany({ where: { roundId: round.id } })
  const totalStars = sumStars(participants)

  return {
    id: round.id,
    status: round.status as PvpRoundStatus,
    totalStars,
    endsAt: roundEndsAt(round.startedAt)?.toISOString() ?? null,
    participants: viewOf(participants, totalStars, viewerId),
    winnerId: round.winnerId?.toString() ?? null,
    winnerName: winnerNameOf(participants, round.winnerId),
    rakeStars: round.rakeStars,
    finishedAt: round.finishedAt?.toISOString() ?? null,
  }
}

/** Текущий активный раунд (polling каждую секунду). */
export async function getCurrentRound(viewerId: bigint): Promise<{ round: PvpRoundView | null }> {
  const round = await findActiveRound()

  if (!round) {
    // Если активного раунда нет, проверяем недавно завершённый (последние 3.5 секунды),
    // чтобы зрители и игроки успели увидеть спин и победителя
    const recentFinished = await prisma.pvpRound.findFirst({
      where: {
        status: 'finished',
        finishedAt: { gte: new Date(Date.now() - 3500) },
      },
      orderBy: { finishedAt: 'desc' },
    })
    if (recentFinished) {
      return { round: await buildRoundView(recentFinished, viewerId) }
    }
    return { round: null }
  }

  await ensureRoundProgress(round)

  const fresh = await prisma.pvpRound.findUnique({ where: { id: round.id } })
  if (!fresh) {
    return { round: null }
  }

  // Возвращаем раунд со всеми данными (включая finished с победителем)
  return { round: await buildRoundView(fresh, viewerId) }
}

/**
 * Вход в лобби. Первый игрок открывает раунд, остальные присоединяются
 * к тому же раунду, пока он открыт. Отсчёт 10 секунд начинается со второго
 * участника и дальше новыми входами не сбрасывается.
 */
export async function joinRound(
  userId: bigint,
  username: string | null,
  stars: number,
): Promise<PvpJoinResult> {
  assertStars(stars)

  const { round, startedNow } = await prisma.$transaction(
    async (tx) => {
      await lockLobby(tx)

      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `
      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.balance < stars) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств для такой ставки', 400)
      }

      const active = await tx.pvpRound.findFirst({
        where: { status: 'open' },
        orderBy: { createdAt: 'desc' },
      })

      let round = active

      if (round) {
        const alreadyIn = await tx.pvpParticipant.findUnique({
          where: { roundId_userId: { roundId: round.id, userId } },
        })
        if (alreadyIn) {
          throw new GameError('ALREADY_JOINED', 'Ты уже участвуешь в этом раунде', 409)
        }
      } else {
        // Первый игрок открывает раунд, но отсчёт ещё НЕ идёт: startedAt = null,
        // таймер запустится, когда в лобби появится второй участник.
        round = await tx.pvpRound.create({ data: { status: 'open', startedAt: null } })
      }

      await tx.user.update({
        where: { id: userId },
        data: { balance: userRow.balance - stars },
      })
      await tx.pvpParticipant.create({
        data: { roundId: round.id, userId, username, stars },
      })

      // История операций: вход в PvP-раунд.
      await logTransaction(userId, 'PVP_BET', -stars, 'Ставка в PvP', tx)

      // ⚠️ DEV ONLY — блок удалить при релизе: дев-игроку сразу подсаживается бот
      // с половинной ставкой, поэтому лобби не ждёт второго живого игрока.
      if (active === null && userId === DEV_TELEGRAM_ID) {
        await tx.pvpParticipant.create({
          data: {
            roundId: round.id,
            userId: BOT_USER_ID,
            username: BOT_NAME,
            stars: Math.floor(stars * 0.5),
            isBot: true,
          },
        })
      }
      // ⚠️ Конец DEV ONLY.

      const participants = await tx.pvpParticipant.findMany({ where: { roundId: round.id } })

      // Отсчёт стартует со ВТОРОГО участника (живого или бота): у 3-го и далее
      // startedAt уже не null, поэтому таймер не сбрасывается и не планируется заново.
      const startTimer = round.startedAt === null && participants.length >= 2

      const updated = await tx.pvpRound.update({
        where: { id: round.id },
        data: {
          totalStars: sumStars(participants),
          ...(startTimer ? { startedAt: new Date() } : {}),
        },
      })

      return { round: updated, startedNow: startTimer }
    },
    { timeout: 10000 },
  )

  // Ставка списана — отыгрываем депозитную часть и платим рефереру 10%.
  processWagering(userId, stars, 'pvp', round.id).catch(console.error)

  // Таймер взводится только если отсчёт начался именно этим входом.
  if (startedNow) {
    scheduleSpin(round.id, roundEndsAt(round.startedAt))
  }

  const roundView = await buildRoundView(round, userId)
  return {
    roundId: round.id,
    endsAt: roundEndsAt(round.startedAt)?.toISOString() ?? null,
    round: roundView,
  }
}

/** Докид ⭐ к своей ставке, пока раунд открыт. */
export async function addToBet(
  userId: bigint,
  roundId: string,
  extraStars: number,
): Promise<{ ok: true; round: PvpRoundView }> {
  if (!Number.isInteger(extraStars) || extraStars < MIN_BET_STARS) {
    throw new GameError('INVALID_BET', `Минимальная добавка — ${MIN_BET_STARS} ⭐`, 400)
  }

  const updatedRound = await prisma.$transaction(
    async (tx) => {
      await lockLobby(tx)

      const round = await tx.pvpRound.findUnique({ where: { id: roundId } })
      if (!round) {
        throw new GameError('ROUND_NOT_FOUND', 'Раунд не найден', 404)
      }
      if (round.status !== 'open') {
        throw new GameError('ROUND_CLOSED', 'Ставки в этом раунде больше не принимаются', 409)
      }

      const participant = await tx.pvpParticipant.findUnique({
        where: { roundId_userId: { roundId, userId } },
      })
      if (!participant) {
        throw new GameError('NOT_IN_ROUND', 'Ты не участвуешь в этом раунде', 403)
      }

      const nextStars = participant.stars + extraStars
      if (nextStars > MAX_BET_STARS) {
        throw new GameError('INVALID_BET', `Ставка не может превышать ${MAX_BET_STARS} ⭐`, 400)
      }

      const rows = await tx.$queryRaw<{ id: bigint; balance: number }[]>`
        SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE
      `
      const userRow = rows[0]
      if (!userRow) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      if (userRow.balance < extraStars) {
        throw new GameError('INSUFFICIENT_FUNDS', 'Недостаточно средств', 400)
      }

      await tx.user.update({
        where: { id: userId },
        data: { balance: userRow.balance - extraStars },
      })
      await tx.pvpParticipant.update({
        where: { id: participant.id },
        data: { stars: nextStars },
      })

      // История операций: докид ставки в PvP.
      await logTransaction(userId, 'PVP_BET', -extraStars, 'Ставка в PvP', tx)

      const participants = await tx.pvpParticipant.findMany({ where: { roundId } })
      return tx.pvpRound.update({
        where: { id: roundId },
        data: { totalStars: sumStars(participants) },
      })
    },
    { timeout: 10000 },
  )

  // Докид — тоже расход: отыгрываем депозитную часть и платим рефереру.
  processWagering(userId, extraStars, 'pvp', roundId).catch(console.error)

  const roundView = await buildRoundView(updatedRound, userId)
  return { ok: true, round: roundView }
}

/** Взвешенный по ставкам выбор победителя. */
function pickWinner(participants: PvpParticipant[], totalStars: number): PvpParticipant {
  let roll = Math.random() * totalStars
  for (const participant of participants) {
    roll -= participant.stars
    if (roll < 0) {
      return participant
    }
  }
  return participants[participants.length - 1]
}

/**
 * Спин раунда. Ставки уже списаны при входе, поэтому здесь только выбор победителя
 * и начисление выплаты. Повторный вызов для завершённого раунда безопасен.
 */
export async function performSpin(roundId: string): Promise<PvpSpinResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      await lockLobby(tx)

      const round = await tx.pvpRound.findUnique({ where: { id: roundId } })
      if (!round) {
        throw new GameError('ROUND_NOT_FOUND', 'Раунд не найден', 404)
      }

      const participants = await tx.pvpParticipant.findMany({ where: { roundId } })
      const totalStars = sumStars(participants)

      if (round.status === 'finished') {
        return {
          round,
          participants,
          totalStars,
          winnerId: round.winnerId,
          payoutStars: 0,
          rakeStars: round.rakeStars,
          refunded: round.winnerId === null,
        }
      }

      await tx.pvpRound.update({
        where: { id: roundId },
        data: { status: 'spinning' },
      })

      // Играть не с кем — возвращаем ставки и закрываем раунд без победителя.
      if (participants.length < 2) {
        for (const participant of participants) {
          if (participant.isBot) {
            continue
          }
          await tx.user.update({
            where: { id: participant.userId },
            data: { balance: { increment: participant.stars } },
          })
        }

        const closed = await tx.pvpRound.update({
          where: { id: roundId },
          data: { status: 'finished', totalStars, winnerId: null, rakeStars: 0, finishedAt: new Date() },
        })

        return {
          round: closed,
          participants,
          totalStars,
          winnerId: null,
          payoutStars: 0,
          rakeStars: 0,
          refunded: true,
        }
      }

      const winner = pickWinner(participants, totalStars)
      const loserPool = totalStars - winner.stars
      const rakeStars = Math.round(loserPool * RAKE_RATE)
      // Выплата = своя ставка + банк проигравших минус комиссия кассы.
      const payoutStars = winner.stars + loserPool - rakeStars

      const finished = await tx.pvpRound.update({
        where: { id: roundId },
        data: {
          status: 'finished',
          totalStars,
          winnerId: winner.userId,
          rakeStars,
          finishedAt: new Date(),
        },
      })

      // Победитель-бот виртуальный: выплачивать некому, касса фиксирует комиссию.
      if (!winner.isBot) {
        await tx.user.update({
          where: { id: winner.userId },
          data: { balance: { increment: payoutStars } },
        })

        // История операций: выигрыш в PvP.
        await logTransaction(winner.userId, 'PVP_WIN', payoutStars, 'Победа в PvP', tx)
      }

      return {
        round: finished,
        participants,
        totalStars,
        winnerId: winner.userId,
        payoutStars: winner.isBot ? 0 : payoutStars,
        rakeStars,
        refunded: false,
      }
    },
    { timeout: 10000 },
  )

  console.log(
    `[PVP] round=${result.round.id} participants=${result.participants.length} ` +
      `total=${result.totalStars} winner=${result.winnerId?.toString() ?? 'none'} ` +
      `rake=${result.rakeStars} payout=${result.payoutStars}${result.refunded ? ' refunded' : ''}`,
  )

  return {
    roundId: result.round.id,
    winnerId: result.winnerId?.toString() ?? null,
    winnerName: winnerNameOf(result.participants, result.winnerId),
    payoutStars: result.payoutStars,
    rakeStars: result.rakeStars,
    totalStars: result.totalStars,
    refunded: result.refunded,
  }
}

/** Последние игры, где игрок был участником. */
export async function getMyHistory(
  userId: bigint,
  limit = 20,
): Promise<PvpHistoryEntry[]> {
  const myRounds = await prisma.pvpParticipant.findMany({
    where: { userId, round: { status: 'finished' } },
    orderBy: { round: { finishedAt: 'desc' } },
    take: limit,
    include: { round: { include: { participants: true } } },
  })

  return myRounds.map((row) => {
    const { round } = row
    const participants = round.participants
    const totalStars = sumStars(participants)
    const iWon = round.winnerId !== null && round.winnerId === userId

    return {
      id: round.id,
      status: round.status as PvpRoundStatus,
      totalStars,
      winnerId: round.winnerId?.toString() ?? null,
      winnerName: winnerNameOf(participants, round.winnerId),
      rakeStars: round.rakeStars,
      finishedAt: round.finishedAt?.toISOString() ?? null,
      participants: viewOf(participants, totalStars, userId),
      myStars: row.stars,
      iWon,
      payoutStars: iWon ? totalStars - round.rakeStars : 0,
    }
  })
}
