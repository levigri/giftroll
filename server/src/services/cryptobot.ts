import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { DepositError, MAX_DEPOSIT_STARS, MIN_DEPOSIT_STARS } from './deposit.js'
import { getStarsBasePriceUsd } from '../utils/rates.js'

/** Crypto Pay API (официальный бот @CryptoBot). */
const CRYPTO_PAY_API_URL = 'https://pay.crypt.bot/api'
/** Наценка шлюза 3% — её платит игрок; на баланс зачисляются ровно звёзды. */
const CRYPTO_GATEWAY_MARKUP = 1.03

interface CryptoPayResponse<T> {
  ok?: boolean
  result?: T
  error?: { code?: number; name?: string; message?: string }
}

interface CryptoInvoiceResult {
  bot_invoice_url: string
  invoice_id?: number | string
}

/** Ошибка слоя пополнений: роуты превращают её в HTTP-ответ. */
async function callCryptoPay<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.CRYPTO_PAY_TOKEN) {
    throw new DepositError(
      'CRYPTO_PAY_NOT_CONFIGURED',
      'Крипто-оплата временно недоступна',
      503,
    )
  }

  let res: Response
  try {
    res = await fetch(`${CRYPTO_PAY_API_URL}/${method}`, {
      method: 'POST',
      headers: {
        'Crypto-Pay-API-Token': env.CRYPTO_PAY_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new DepositError('CRYPTO_PAY_ERROR', 'Сервис оплаты недоступен', 502)
  }

  const data = (await res.json().catch(() => null)) as CryptoPayResponse<T> | null

  if (!res.ok || !data?.ok || !data.result) {
    throw new DepositError(
      'CRYPTO_PAY_ERROR',
      data?.error?.message ?? `Crypto Pay API ${method} failed with HTTP ${res.status}`,
      502,
    )
  }

  return data.result
}

/**
 * Создаёт счёт в @CryptoBot и pending-запись в Deposit.
 * Отдаёт ссылку на оплату и id депозита (по нему вебхук найдёт запись).
 */
export async function createCryptoInvoice(
  userId: bigint,
  starsAmount: number,
): Promise<{ invoiceLink: string; depositId: string }> {
  if (
    !Number.isInteger(starsAmount) ||
    starsAmount < MIN_DEPOSIT_STARS ||
    starsAmount > MAX_DEPOSIT_STARS
  ) {
    throw new DepositError(
      'INVALID_AMOUNT',
      `Сумма от ${MIN_DEPOSIT_STARS} до ${MAX_DEPOSIT_STARS} ⭐`,
      400,
    )
  }

  const payload = `crypto_dep_${userId}_${Date.now()}`
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      amount: starsAmount,
      status: 'pending',
      currency: 'CRYPTO',
      payload,
    },
  })

  try {
    // Базовая цена по курсу 100 ⭐ = $1.40 плюс комиссия шлюза 3%:
    // 50 ⭐ → $0.70 → к оплате $0.721. Начисляются при этом ровно 50 ⭐.
    const baseUsd = getStarsBasePriceUsd(starsAmount)
    const finalUsd = baseUsd * CRYPTO_GATEWAY_MARKUP
    const amount = finalUsd.toFixed(4).replace(/\.?0+$/, '')

    const result = await callCryptoPay<CryptoInvoiceResult>('createInvoice', {
      currency_type: 'fiat',
      fiat: 'USD',
      amount,
      description: `Пополнение GiftRoll на ${starsAmount} ⭐`,
      payload,
    })

    if (!result.bot_invoice_url) {
      throw new DepositError('CRYPTO_PAY_ERROR', 'Crypto Bot не вернул ссылку на счёт', 502)
    }

    return { invoiceLink: result.bot_invoice_url, depositId: deposit.id }
  } catch (err) {
    // Счёт не создался — депозит не должен остаться «висеть» pending.
    await prisma.deposit
      .update({ where: { id: deposit.id }, data: { status: 'failed' } })
      .catch(() => undefined)
    throw err
  }
}

/** Payload вебхука: `update.payload.payload` либо `update.payload.invoice.payload`. */
function extractPayload(update: unknown): string | null {
  const body = update as
    | {
        payload?: { payload?: string; invoice?: { payload?: string } }
      }
    | null
    | undefined

  const payload = body?.payload?.payload ?? body?.payload?.invoice?.payload
  return typeof payload === 'string' && payload.length > 0 ? payload : null
}

/**
 * Обрабатывает вебхук Crypto Pay: при `invoice_paid` зачисляет ⭐ на баланс.
 * Повторная доставка того же вебхука безопасна: неповторный pending-депозит
 * второй раз уже не обновится.
 */
export async function handleCryptoWebhook(update: unknown): Promise<{ ok: boolean }> {
  const body = update as { update_type?: string } | null | undefined
  if (body?.update_type !== 'invoice_paid') {
    return { ok: true }
  }

  const payload = extractPayload(update)
  if (!payload) {
    return { ok: true }
  }

  const deposit = await prisma.deposit.findUnique({ where: { payload } })
  if (!deposit || deposit.status !== 'pending') {
    return { ok: true }
  }

  await prisma.$transaction([
    prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: 'completed', completedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: deposit.userId },
      data: {
        balance: { increment: deposit.amount },
        depositUnspent: { increment: deposit.amount },
      },
    }),
    // История операций: зачисление пополнения через CryptoBot (ровно звёзды).
    prisma.transaction.create({
      data: {
        userId: deposit.userId,
        type: 'DEPOSIT',
        amount: deposit.amount,
        details: 'Пополнение (CryptoBot)',
      },
    }),
  ])

  return { ok: true }
}
