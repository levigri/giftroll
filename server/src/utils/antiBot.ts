import { prisma } from '../db/prisma.js'
import { getTelegramStarsRating } from '../services/userbot.js'

/**
 * Flags empty accounts with no completed deposits, profile signals, or
 * positive Telegram Stars rating. Missing userbot data is handled safely.
 */
export async function isBotAccount(userId: bigint): Promise<boolean> {
  const depositsCount = await prisma.deposit.count({
    where: { userId, status: 'completed' },
  })
  if (depositsCount > 0) return false

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, photoUrl: true },
  })
  if (!user) return true

  const rating = await getTelegramStarsRating(userId)
  const hasProfileSignal = Boolean(user.username?.trim() || user.photoUrl?.trim())
  const hasPositiveRating = rating !== null && rating >= 0

  return !hasProfileSignal && !hasPositiveRating
}
