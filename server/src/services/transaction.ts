import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'

/**
 * Типы операций в истории баланса.
 * DEPOSIT, CASE_OPEN, UPGRADE, PVP_BET, PVP_WIN, SELL_NFT, DAILY_BONUS, REFERRAL
 */
export type TransactionType =
  | 'DEPOSIT'
  | 'CASE_OPEN'
  | 'UPGRADE'
  | 'PVP_BET'
  | 'PVP_WIN'
  | 'SELL_NFT'
  | 'DAILY_BONUS'
  | 'REFERRAL'

/**
 * Пишет запись в историю операций пользователя.
 *
 * `amount` > 0 — доход (пополнение, выигрыш, бонус), < 0 — расход (ставка, покупка).
 * Внутри `prisma.$transaction` передавай тот же `tx`: тогда запись либо уходит
 * вместе с основным действием, либо откатывается вместе с ним.
 *
 * Ошибка логирования не должна ломать игровое действие — поэтому глотаем её
 * с пометкой в логах.
 */
export async function logTransaction(
  userId: bigint,
  type: TransactionType,
  amount: number,
  details: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    await client.transaction.create({
      data: { userId, type, amount, details },
    })
  } catch (err) {
    console.error(`[Transaction] failed to log ${type} for user ${userId}:`, err)
  }
}
