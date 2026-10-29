import type { Prisma } from '@prisma/client'

const DEPOSIT_LOCK_MS = 21 * 24 * 60 * 60 * 1000

/**
 * Возвращает срок блокировки от последнего активного депозита.
 * Старые completed-записи без lockUntil восстанавливаются по completedAt.
 */
export async function findActiveDepositLock(
  tx: Prisma.TransactionClient,
  userId: bigint,
  now = new Date(),
): Promise<Date | null> {
  const lockCutoff = new Date(now.getTime() - DEPOSIT_LOCK_MS)
  const deposit = await tx.deposit.findFirst({
    where: {
      userId,
      status: 'completed',
      OR: [
        { lockUntil: { gt: now } },
        { lockUntil: null, completedAt: { gt: lockCutoff } },
        { lockUntil: null, completedAt: null, createdAt: { gt: lockCutoff } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { lockUntil: true, completedAt: true, createdAt: true },
  })

  if (!deposit) return null
  return deposit.lockUntil ?? new Date((deposit.completedAt ?? deposit.createdAt).getTime() + DEPOSIT_LOCK_MS)
}
