import { nftCatalog } from '../data/nftCatalog.js'
import { promoCasePrizes } from '../data/promoCase.js'
import { prisma } from '../db/prisma.js'
import { pickDailyBonusPrize } from '../utils/prize.js'
import { GameError } from './game.js'
import { logTransaction } from './transaction.js'

export async function checkPromoCode(code: string): Promise<boolean> {
  const promo = await prisma.promoCode.findUnique({
    where: { code },
    select: { currentUses: true, maxUses: true },
  })
  return Boolean(promo && promo.currentUses < promo.maxUses)
}

export async function openPromoCase(
  userId: bigint,
  code: string,
): Promise<{
  prize: { id: string; label: string; emoji: string; amount: number; type: 'BALANCE' | 'NFT' }
  newBalance: number
  currentUses: number
}> {
  return prisma.$transaction(async (tx) => {
    const promo = await tx.promoCode.findUnique({ where: { code } })
    if (!promo) {
      throw new GameError('PROMO_INVALID', 'Код не найден или исчерпан', 400)
    }

    // Условное атомарное обновление не позволяет параллельным запросам
    // превысить maxUses даже при одновременной проверке одного кода.
    const claimed = await tx.promoCode.updateMany({
      where: { id: promo.id, currentUses: { lt: promo.maxUses } },
      data: { currentUses: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      throw new GameError('PROMO_EXHAUSTED', 'Код не найден или исчерпан', 400)
    }

    const prize = pickDailyBonusPrize(promoCasePrizes)
    let newBalance: number

    if (prize.type === 'BALANCE') {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: prize.amount } },
        select: { balance: true },
      })
      newBalance = user.balance
      await logTransaction(userId, 'DAILY_BONUS', prize.amount, `Промокод-кейс: +${prize.amount} ⭐`, tx)
    } else {
      const nft = nftCatalog.find((item) => item.name === prize.label)
      if (!nft) {
        throw new GameError('PROMO_PRIZE_CONFIG', `NFT ${prize.label} отсутствует в каталоге`, 500)
      }

      await tx.inventoryItem.create({
        data: {
          userId,
          prizeId: prize.id,
          prizeName: prize.label,
          prizeEmoji: prize.emoji,
          prizePrice: nft.price,
          isExternal: false,
          lockUntil: null,
          status: 'PENDING',
        },
      })
      const user = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } })
      if (!user) {
        throw new GameError('USER_NOT_FOUND', 'Пользователь не найден', 404)
      }
      newBalance = user.balance
    }

    const usage = await tx.promoCode.findUnique({
      where: { id: promo.id },
      select: { currentUses: true },
    })

    return {
      prize: {
        id: prize.id,
        label: prize.label,
        emoji: prize.emoji,
        amount: prize.amount,
        type: prize.type,
      },
      newBalance,
      currentUses: usage?.currentUses ?? promo.currentUses + 1,
    }
  })
}
