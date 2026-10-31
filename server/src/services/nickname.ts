import { prisma } from '../db/prisma.js'
import { checkNicknameContainsGiftRoll } from './bot.js'

export const NICKNAME_STREAK_TARGET = 7

export function startOfUTCDay(date: Date): Date {
  const result = new Date(date)
  result.setUTCHours(0, 0, 0, 0)
  return result
}

const dailyNicknameChecks = new Map<string, { day: string; result: Promise<{ hasNick: boolean; streak: number }> }>()

/** Checks the profile name and updates the daily streak, caching GET checks for the UTC day. */
export async function checkNicknameTask(
  userId: bigint,
  forceFresh: boolean,
): Promise<{ hasNick: boolean; streak: number }> {
  const today = startOfUTCDay(new Date())
  const dayKey = today.toISOString().slice(0, 10)
  const userKey = userId.toString()
  const cached = dailyNicknameChecks.get(userKey)
  if (!forceFresh && cached?.day === dayKey) return cached.result

  const resultPromise = updateNicknameStreak(userId, forceFresh, today)
  dailyNicknameChecks.set(userKey, { day: dayKey, result: resultPromise })
  try {
    return await resultPromise
  } catch (err) {
    if (dailyNicknameChecks.get(userKey)?.result === resultPromise) {
      dailyNicknameChecks.delete(userKey)
    }
    throw err
  }
}

async function updateNicknameStreak(
  userId: bigint,
  forceFresh: boolean,
  today: Date,
): Promise<{ hasNick: boolean; streak: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nicknameStreakDays: true, nicknameCheckedAt: true },
  })
  if (!user) return { hasNick: false, streak: 0 }

  if (user.nicknameStreakDays >= NICKNAME_STREAK_TARGET) {
    return { hasNick: true, streak: user.nicknameStreakDays }
  }

  const lastChecked = user.nicknameCheckedAt ? startOfUTCDay(user.nicknameCheckedAt) : null
  const checkedToday = lastChecked !== null && lastChecked.getTime() === today.getTime()

  if (!forceFresh && checkedToday) {
    return { hasNick: user.nicknameStreakDays > 0, streak: user.nicknameStreakDays }
  }

  const hasNick = await checkNicknameContainsGiftRoll(userId)

  if (!hasNick) {
    // Recording today's check also prevents repeated getChat calls during the same UTC day.
    await prisma.user.update({
      where: { id: userId },
      data: { nicknameStreakDays: 0, nicknameCheckedAt: today },
    })
    return { hasNick: false, streak: 0 }
  }

  if (checkedToday) {
    return { hasNick: true, streak: user.nicknameStreakDays }
  }

  const yesterday = startOfUTCDay(new Date(today.getTime() - 24 * 60 * 60 * 1000))
  const continues = lastChecked !== null && lastChecked.getTime() === yesterday.getTime()
  const nextStreak = continues ? user.nicknameStreakDays + 1 : 1

  await prisma.user.update({
    where: { id: userId },
    data: { nicknameStreakDays: nextStreak, nicknameCheckedAt: today },
  })
  return { hasNick: true, streak: nextStreak }
}
