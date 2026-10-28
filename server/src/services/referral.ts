import { prisma } from '../db/prisma.js'

/** Префикс реферального кода: ref_<telegramId>. */
const REF_CODE_PREFIX = 'ref_'
/** Сколько последних попыток привязки отдаём на фронт. */
const ATTEMPTS_LIMIT = 20
/** Одинаковые попытки в пределах окна не дублируем (несколько запросов на старте). */
const BIND_CACHE_TTL_MS = 60_000

export class ReferralError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'ReferralError'
  }
}

export type ReferralAttemptStatus = 'success' | 'self_invite' | 'already_bound' | 'invalid'

/** Результат попытки привязки: reason показывается пользователю при входе по ссылке. */
export type ReferralBindResult = { ok: true } | { ok: false; reason: string }

export interface ReferralEarningView {
  id: string
  referredId: string
  username: string | null
  firstName: string | null
  amount: number
  sourceType: string
  createdAt: string
}

export interface ReferralInviteView {
  id: string
  username: string | null
  firstName: string | null
  createdAt: string
}

export interface ReferralAttemptView {
  id: string
  referredId: string
  username: string | null
  firstName: string | null
  status: ReferralAttemptStatus
  createdAt: string
}

export interface ReferralStats {
  refCode: string
  totalEarned: number
  referredCount: number
  successfulInvites: ReferralInviteView[]
  recentAttempts: ReferralAttemptView[]
  recentEarnings: ReferralEarningView[]
}

/** Кэш результатов, чтобы параллельные запросы на старте не плодили одинаковые попытки. */
const recentBinds = new Map<string, { result: ReferralBindResult; expiresAt: number }>()
const inFlightBinds = new Map<string, Promise<ReferralBindResult>>()

function cacheKey(userId: bigint, refCode: string): string {
  return `${userId.toString()}:${refCode}`
}

async function recordAttempt(
  referrerId: bigint,
  referredId: bigint,
  status: ReferralAttemptStatus,
): Promise<void> {
  try {
    await prisma.referralAttempt.create({
      data: { referrerId, referredId, status },
    })
  } catch (error) {
    // Лог попыток не должен ломать вход в приложение.
    console.error('[REFERRAL] failed to record attempt:', error)
  }
}

/**
 * Привязывает реферера к пользователю по коду 'ref_<number>'.
 * Каждая попытка (успешная и нет) пишется в ReferralAttempt,
 * чтобы на странице «Друзья» было видно, кто перешёл и почему не засчитался.
 */
export async function bindReferrer(
  userId: bigint,
  refCode: string,
): Promise<ReferralBindResult> {
  const key = cacheKey(userId, refCode)

  const cached = recentBinds.get(key)
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.result
    }
    recentBinds.delete(key)
  }

  // Параллельные запросы (getMe + getCases в Promise.all) ждут один и тот же bind.
  const existing = inFlightBinds.get(key)
  if (existing) {
    return existing
  }

  const promise = resolveBind(userId, refCode)
    .then((result) => {
      if (recentBinds.size > 500) {
        recentBinds.clear()
      }
      recentBinds.set(key, { result, expiresAt: Date.now() + BIND_CACHE_TTL_MS })
      return result
    })
    .finally(() => {
      inFlightBinds.delete(key)
    })

  inFlightBinds.set(key, promise)
  return promise
}

async function resolveBind(userId: bigint, refCode: string): Promise<ReferralBindResult> {
  const digits = refCode.startsWith(REF_CODE_PREFIX)
    ? refCode.slice(REF_CODE_PREFIX.length).trim()
    : ''

  if (!/^\d{1,20}$/.test(digits)) {
    // Реферера не существует — пишем 0, чтобы запись всё равно попала в лог.
    await recordAttempt(0n, userId, 'invalid')
    return { ok: false, reason: 'Неверный код' }
  }

  const referrerId = BigInt(digits)

  // Себя пригласить нельзя — иначе 10% уходили бы самому себе.
  if (referrerId === userId) {
    await recordAttempt(referrerId, userId, 'self_invite')
    return { ok: false, reason: 'Нельзя пригласить себя' }
  }

  try {
    const [referrer, user] = await Promise.all([
      prisma.user.findUnique({
        where: { id: referrerId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { referredBy: true },
      }),
    ])

    if (!user) {
      await recordAttempt(referrerId, userId, 'invalid')
      return { ok: false, reason: 'Пользователь не найден' }
    }

    // Уже привязан к кому-то (в том числе к этому же рефереру) — перепривязки нет.
    if (user.referredBy !== null) {
      await recordAttempt(referrerId, userId, 'already_bound')
      return { ok: false, reason: 'Вы уже привязаны к другому рефереру' }
    }

    if (!referrer) {
      await recordAttempt(referrerId, userId, 'invalid')
      return { ok: false, reason: 'Реферер не найден' }
    }

    // WHERE referredBy IS NULL делает привязку однократной даже при гонке.
    const bound = await prisma.user.updateMany({
      where: { id: userId, referredBy: null },
      data: { referredBy: referrerId },
    })

    if (bound.count === 0) {
      await recordAttempt(referrerId, userId, 'already_bound')
      return { ok: false, reason: 'Вы уже привязаны к другому рефереру' }
    }

    await recordAttempt(referrerId, userId, 'success')
    console.log(`[REFERRAL] user=${userId} referredBy=${referrerId}`)
    return { ok: true }
  } catch (error) {
    console.error('[REFERRAL] bindReferrer failed:', error)
    return { ok: false, reason: 'Не удалось привязать реферера' }
  }
}

/** Статистика реферальной программы для страницы «Друзья». */
export async function getStats(userId: bigint, limit = 20): Promise<ReferralStats> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)

  const [user, referredCount, successfulInvites, recentAttempts, recentEarnings] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { refEarnings: true },
      }),
      prisma.user.count({ where: { referredBy: userId } }),
      prisma.user.findMany({
        where: { referredBy: userId },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        select: { id: true, username: true, firstName: true, createdAt: true },
      }),
      prisma.referralAttempt.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: ATTEMPTS_LIMIT,
      }),
      prisma.referralEarning.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
      }),
    ])

  if (!user) {
    throw new ReferralError('USER_NOT_FOUND', 'Пользователь не найден', 404)
  }

  // В логе переходов и начислениях хранится только id — подтягиваем ники одним запросом,
  // чтобы на «Друзьях» везде были имена, а не Player #ID.
  const personIds = [
    ...new Set(
      [...recentAttempts, ...recentEarnings].map((entry) => entry.referredId.toString()),
    ),
  ]
  const people = personIds.length
    ? await prisma.user.findMany({
        where: { id: { in: personIds.map((id) => BigInt(id)) } },
        select: { id: true, username: true, firstName: true },
      })
    : []
  const peopleById = new Map(people.map((person) => [person.id.toString(), person]))

  return {
    refCode: `${REF_CODE_PREFIX}${userId.toString()}`,
    totalEarned: user.refEarnings,
    referredCount,
    successfulInvites: successfulInvites.map((invite) => ({
      id: invite.id.toString(),
      username: invite.username,
      firstName: invite.firstName,
      createdAt: invite.createdAt.toISOString(),
    })),
    recentAttempts: recentAttempts.map((attempt) => {
      const person = peopleById.get(attempt.referredId.toString())
      return {
        id: attempt.id,
        referredId: attempt.referredId.toString(),
        username: person?.username ?? null,
        firstName: person?.firstName ?? null,
        status: attempt.status as ReferralAttemptStatus,
        createdAt: attempt.createdAt.toISOString(),
      }
    }),
    recentEarnings: recentEarnings.map((earning) => {
      const person = peopleById.get(earning.referredId.toString())
      return {
        id: earning.id,
        referredId: earning.referredId.toString(),
        username: person?.username ?? null,
        firstName: person?.firstName ?? null,
        amount: earning.amount,
        sourceType: earning.sourceType,
        createdAt: earning.createdAt.toISOString(),
      }
    }),
  }
}
