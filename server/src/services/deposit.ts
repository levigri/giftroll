import { randomBytes } from 'node:crypto'
import { Address, Cell, beginCell, loadMessage } from '@ton/core'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { getGramRate, getStarsBasePriceUsd } from '../utils/rates.js'
import { logTransaction } from './transaction.js'
import { notifyUser } from './bot.js'

/** Границы одного пополнения в ⭐. */
export const MIN_DEPOSIT_STARS = 10
export const MAX_DEPOSIT_STARS = 100_000

/** Реферер получает 10% от отыгранной части депозита приглашённого. */
export const REFERRAL_RATE_PERCENT = 10
const TONAPI_BASE_URL = 'https://tonapi.io/v2'
/** Фиксированный минимум допуска по сумме перевода: газ и округления. */
const TON_AMOUNT_TOLERANCE_NANO = 10_000_000n // 0.01 TON
/** Допуск в процентах от ожидаемой суммы. */
const TON_AMOUNT_TOLERANCE_PERCENT = 5n

/** ⚠️ DEV ONLY — удалить этот блок при релизе */
const DEV_TELEGRAM_ID = 11111111n

/** Ошибка слоя пополнений: роуты превращают её в HTTP-ответ. */
export class DepositError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'DepositError'
  }
}

type TonApiMessage = {
  destination?: string | { address?: string } | null
  value?: string | number | null
  bounced?: boolean
}

type TonApiTransaction = {
  hash?: string
  success?: boolean
  account?: string | { address?: string }
  out_msgs?: TonApiMessage[]
}

function addressString(address: string | { address?: string } | null | undefined): string | null {
  if (typeof address === 'string') return address
  return address?.address ?? null
}

function normalizeAddress(address: string | { address?: string } | null | undefined): string | null {
  const value = addressString(address)?.trim()
  if (!value) return null
  try {
    return Address.parse(value).toRawString().toLowerCase()
  } catch {
    return null
  }
}

/** TonConnect returns a signed external-message BOC, not the resulting tx hash. */
function getNormalizedMessageHash(transactionBoc: string): { hash: string; sender: Address } {
  try {
    const roots = Cell.fromBoc(Buffer.from(transactionBoc, 'base64'))
    if (roots.length !== 1) throw new Error('Expected one BOC root')

    const message = loadMessage(roots[0].beginParse())
    if (message.info.type !== 'external-in') throw new Error('Expected an external-in message')

    const normalized = beginCell()
      .storeUint(2, 2)
      .storeUint(0, 2)
      .storeAddress(message.info.dest)
      .storeUint(0, 4)
      .storeBit(false)
      .storeBit(true)
      .storeRef(message.body)
      .endCell()

    return { hash: normalized.hash().toString('hex'), sender: message.info.dest }
  } catch {
    throw new DepositError('INVALID_TX', 'Подписанная TON-транзакция некорректна', 400)
  }
}

/* ------------------------------ Telegram Bot API ------------------------------ */

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

interface TelegramPreCheckoutQuery {
  id: string
  invoice_payload: string
}

interface TelegramSuccessfulPayment {
  invoice_payload: string
  telegram_payment_charge_id: string
  total_amount: number
  currency: string
}

/** Подмножество update, которое приходит на webhook. */
export interface TelegramUpdate {
  pre_checkout_query?: TelegramPreCheckoutQuery
  message?: {
    successful_payment?: TelegramSuccessfulPayment
  }
}

async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = (await res.json().catch(() => null)) as TelegramApiResponse<T> | null

  if (!res.ok || !data?.ok) {
    throw new DepositError(
      'TELEGRAM_API_ERROR',
      data?.description ?? `Telegram API ${method} failed with HTTP ${res.status}`,
      502,
    )
  }

  return data.result as T
}

/* -------------------------------- Пополнение Stars --------------------------------- */

function newPayload(userId: bigint): string {
  return `dep_${userId}_${Date.now()}_${randomBytes(4).toString('hex')}`
}

export async function createInvoice(
  userId: bigint,
  amount: number,
): Promise<{ invoiceLink: string; depositId: string }> {
  if (!Number.isInteger(amount) || amount < MIN_DEPOSIT_STARS || amount > MAX_DEPOSIT_STARS) {
    throw new DepositError(
      'INVALID_AMOUNT',
      `Сумма должна быть целым числом от ${MIN_DEPOSIT_STARS} до ${MAX_DEPOSIT_STARS} ⭐`,
      400,
    )
  }

  const payload = newPayload(userId)
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      amount,
      status: 'pending',
      payload,
      currency: 'STARS',
    },
  })

  try {
    const invoiceLink = await callTelegramApi<string>('createInvoiceLink', {
      title: 'Пополнение GiftRoll',
      description: `${amount}⭐`,
      payload,
      currency: 'XTR',
      prices: [{ label: 'Пополнение', amount }],
    })

    return { invoiceLink, depositId: deposit.id }
  } catch (error) {
    await prisma.deposit
      .update({ where: { id: deposit.id }, data: { status: 'failed' } })
      .catch((updateError: unknown) => {
        console.error('[DEPOSIT] failed to mark deposit as failed:', updateError)
      })
    throw error
  }
}

/* -------------------------------- Пополнение Grams -------------------------------- */

export async function createGramsInvoice(
  userId: bigint,
  starsAmount: number,
): Promise<{
  depositId: string
  gramsAmount: number
  starsAmount: number
  receiverAddress: string
}> {
  if (!env.TON_RECEIVER_ADDRESS) {
    throw new DepositError('TON_RECEIVER_NOT_CONFIGURED', 'TON_RECEIVER_ADDRESS не настроен', 503)
  }

  const quote = await quoteGramsAmount(starsAmount)
  const payload = newPayload(userId)

  const deposit = await prisma.deposit.create({
    data: {
      userId,
      amount: quote.starsAmount,
      gramsAmount: quote.gramsAmount,
      status: 'pending',
      payload,
      currency: 'GRAMS',
    },
  })

  return {
    depositId: deposit.id,
    ...quote,
    receiverAddress: env.TON_RECEIVER_ADDRESS,
  }
}

export async function quoteGramsAmount(starsAmount: number): Promise<{
  gramsAmount: number
  starsAmount: number
}> {
  if (
    !Number.isInteger(starsAmount) ||
    starsAmount < MIN_DEPOSIT_STARS ||
    starsAmount > MAX_DEPOSIT_STARS
  ) {
    throw new DepositError(
      'INVALID_AMOUNT',
      `Сумма должна быть целым числом от ${MIN_DEPOSIT_STARS} до ${MAX_DEPOSIT_STARS} ⭐`,
      400,
    )
  }

  // Начисляемые ⭐ включают 5% бонус, а сумма TON получает 5% скидку.
  const creditedStarsAmount = Math.round(starsAmount * 1.05)
  const usdAmount = getStarsBasePriceUsd(starsAmount)
  const tonRate = await getGramRate()
  const baseGrams = usdAmount / tonRate
  const discountedGrams = baseGrams * 0.95
  const gramsAmount = Math.round(discountedGrams * 1_000_000) / 1_000_000
  return { gramsAmount, starsAmount: creditedStarsAmount }
}

export async function confirmGramsDeposit(
  userId: bigint,
  depositId: string,
  transactionBoc: string,
): Promise<{ ok: boolean; starsAmount: number }> {
  try {
    return await confirmGramsDepositInner(userId, depositId, transactionBoc)
  } catch (error) {
    // Пользователь должен узнать, что перевод бот увидел, но проверить его не удалось.
    if (
      error instanceof DepositError &&
      (error.code === 'INVALID_TX' || error.code === 'TONAPI_ERROR')
    ) {
      void notifyUser(userId, '❌ Не удалось проверить транзакцию. Обратитесь в поддержку.')
    }
    throw error
  }
}

async function confirmGramsDepositInner(
  userId: bigint,
  depositId: string,
  transactionBoc: string,
): Promise<{ ok: boolean; starsAmount: number }> {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
  })

  if (!deposit || deposit.userId !== userId) {
    throw new DepositError('DEPOSIT_NOT_FOUND', 'Депозит не найден', 404)
  }

  if (deposit.status === 'completed') {
    return { ok: true, starsAmount: deposit.amount }
  }

  if (!deposit.gramsAmount) {
    throw new DepositError('INVALID_DEPOSIT', 'Это не депозит в Grams', 400)
  }
  if (deposit.status !== 'pending') {
    throw new DepositError('INVALID_DEPOSIT_STATUS', 'Депозит уже обработан', 400)
  }
  if (!env.TON_RECEIVER_ADDRESS) {
    throw new DepositError('TON_RECEIVER_NOT_CONFIGURED', 'TON_RECEIVER_ADDRESS не настроен', 503)
  }

  let receiver: Address
  try {
    receiver = Address.parse(env.TON_RECEIVER_ADDRESS)
  } catch {
    throw new DepositError('TON_RECEIVER_NOT_CONFIGURED', 'TON_RECEIVER_ADDRESS некорректен', 503)
  }

  const { hash: messageHash, sender } = getNormalizedMessageHash(transactionBoc)
  const senderRaw = sender.toRawString().toLowerCase()
  const messageUrl = `${TONAPI_BASE_URL}/blockchain/messages/${encodeURIComponent(messageHash)}/transaction`

  let transactionHash: string
  try {
    const messageResponse = await fetch(messageUrl, { signal: AbortSignal.timeout(10_000) })
    if (messageResponse.status === 404) {
      throw new DepositError('INVALID_TX', 'TON-транзакция не найдена', 400)
    }
    if (!messageResponse.ok) {
      throw new DepositError('TONAPI_ERROR', `TonAPI вернул HTTP ${messageResponse.status}`, 502)
    }

    const resolved = (await messageResponse.json()) as TonApiTransaction
    if (!resolved.hash) {
      throw new DepositError('INVALID_TX', 'TonAPI не нашёл транзакцию по сообщению', 400)
    }
    transactionHash = resolved.hash
  } catch (error) {
    if (error instanceof DepositError) throw error
    throw new DepositError('TONAPI_ERROR', 'Не удалось проверить TON-транзакцию', 502)
  }

  let transaction: TonApiTransaction
  try {
    const response = await fetch(
      `${TONAPI_BASE_URL}/blockchain/transactions/${encodeURIComponent(transactionHash)}`,
      { signal: AbortSignal.timeout(10_000) },
    )
    if (response.status === 404) {
      throw new DepositError('INVALID_TX', 'TON-транзакция не найдена', 400)
    }
    if (!response.ok) {
      throw new DepositError('TONAPI_ERROR', `TonAPI вернул HTTP ${response.status}`, 502)
    }
    transaction = (await response.json()) as TonApiTransaction
  } catch (error) {
    if (error instanceof DepositError) throw error
    throw new DepositError('TONAPI_ERROR', 'Не удалось проверить TON-транзакцию', 502)
  }

  const accountRaw = normalizeAddress(transaction.account)
  if (transaction.success !== true || accountRaw !== senderRaw) {
    throw new DepositError('INVALID_TX', 'TON-транзакция неуспешна или отправлена другим кошельком', 400)
  }

  const expectedNano = BigInt(Math.round(deposit.gramsAmount * 1_000_000_000))
  // Допуск: 5% от ожидаемой суммы или фиксированные 0.01 TON — что больше.
  // Комиссия сети и округления не должны валить уже оплаченный перевод
  // (например, 0.098 TON вместо ожидаемых 0.1 TON).
  const percentNano = (expectedNano * TON_AMOUNT_TOLERANCE_PERCENT) / 100n
  const allowedNano =
    percentNano > TON_AMOUNT_TOLERANCE_NANO ? percentNano : TON_AMOUNT_TOLERANCE_NANO

  const matchingPayment = (transaction.out_msgs ?? []).some((message) => {
    if (message.bounced) return false
    const destinationRaw = normalizeAddress(message.destination)
    if (destinationRaw !== receiver.toRawString().toLowerCase()) return false
    try {
      const value = BigInt(String(message.value))
      const difference = value > expectedNano ? value - expectedNano : expectedNano - value
      return difference <= allowedNano
    } catch {
      return false
    }
  })

  if (!matchingPayment) {
    throw new DepositError('INVALID_TX', 'Получатель или сумма TON-перевода не совпадают', 400)
  }

  const reusedTransaction = await prisma.deposit.findFirst({ where: { txHash: transactionHash } })
  if (reusedTransaction && reusedTransaction.id !== deposit.id) {
    throw new DepositError('TX_ALREADY_USED', 'Эта TON-транзакция уже была использована', 400)
  }

  let claimed: boolean
  try {
    claimed = await prisma.$transaction(
      async (tx) => {
        const result = await tx.deposit.updateMany({
          where: { id: deposit.id, status: 'pending' },
          data: {
            status: 'completed',
            txHash: transactionHash,
            completedAt: new Date(),
          },
        })

        if (result.count === 0) return false

        await tx.user.update({
          where: { id: deposit.userId },
          data: {
            balance: { increment: deposit.amount },
            depositUnspent: { increment: deposit.amount },
          },
        })

        // История операций: зачисление пополнения через Gram.
        await logTransaction(
          deposit.userId,
          'DEPOSIT',
          deposit.amount,
          'Пополнение (Gram)',
          tx,
        )
        return true
      },
      { timeout: 10000 },
    )
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new DepositError('TX_ALREADY_USED', 'Эта TON-транзакция уже была использована', 400)
    }
    throw error
  }

  if (!claimed) {
    throw new DepositError('INVALID_DEPOSIT_STATUS', 'Депозит уже обработан', 400)
  }

  // Уведомление в бота: Gram-депозит зачислен.
  void notifyUser(deposit.userId, `✅ Баланс успешно пополнен на ${deposit.amount} ⭐!`)

  return { ok: true, starsAmount: deposit.amount }
}

/* ------------------------------- Обработка Webhook ------------------------------- */

export async function handleWebhook(update: TelegramUpdate): Promise<void> {
  const query = update.pre_checkout_query
  if (query) {
    const deposit = await prisma.deposit.findUnique({
      where: { payload: query.invoice_payload },
    })
    const ok = deposit !== null && deposit.status === 'pending'

    if (!ok) {
      console.warn(`[DEPOSIT] pre_checkout rejected payload=${query.invoice_payload}`)
    }

    await callTelegramApi<boolean>('answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok,
      ...(ok ? {} : { error_message: 'Счёт не найден или уже оплачен' }),
    }).catch((error: unknown) => {
      console.error('[DEPOSIT] answerPreCheckoutQuery failed:', error)
    })
    return
  }

  const payment = update.message?.successful_payment
  if (!payment) {
    return
  }

  const deposit = await prisma.deposit.findUnique({
    where: { payload: payment.invoice_payload },
  })

  if (!deposit) {
    console.error(`[DEPOSIT] unknown invoice_payload=${payment.invoice_payload}`)
    return
  }

  if (deposit.status === 'completed') {
    return
  }

  if (payment.total_amount !== deposit.amount) {
    console.error(
      `[DEPOSIT] amount mismatch deposit=${deposit.id} expected=${deposit.amount} got=${payment.total_amount}`,
    )
    throw new DepositError(
      'AMOUNT_MISMATCH',
      `Сумма платежа ${payment.total_amount} не совпадает со счётом ${deposit.amount}`,
      400,
    )
  }

  await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.deposit.updateMany({
        where: { id: deposit.id, status: 'pending' },
        data: {
          status: 'completed',
          telegramChargeId: payment.telegram_payment_charge_id,
          completedAt: new Date(),
        },
      })

      if (claimed.count === 0) {
        return
      }

      await tx.user.update({
        where: { id: deposit.userId },
        data: {
          balance: { increment: deposit.amount },
          depositUnspent: { increment: deposit.amount },
        },
      })

      // История операций: зачисление пополнения через Telegram Stars.
      await logTransaction(
        deposit.userId,
        'DEPOSIT',
        deposit.amount,
        'Пополнение (Stars)',
        tx,
      )
    },
    { timeout: 10000 },
  )

  // Уведомление в бота: звёзды зачислены.
  void notifyUser(deposit.userId, `✅ Баланс успешно пополнен на ${deposit.amount} ⭐!`)
}

/* ------------------------------- Wagering/рефы ------------------------------- */

export async function processWagering(
  userId: bigint,
  spentAmount: number,
  sourceType: string,
  sourceId?: string | null,
): Promise<void> {
  try {
    if (!Number.isFinite(spentAmount) || spentAmount <= 0) {
      return
    }

    await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { depositUnspent: true, referredBy: true },
        })

        if (!user) {
          return
        }

        const depositPortion = Math.min(Math.floor(spentAmount), user.depositUnspent)
        if (depositPortion <= 0) {
          return
        }

        await tx.user.update({
          where: { id: userId },
          data: { depositUnspent: { decrement: depositPortion } },
        })

        const referrerId = user.referredBy
        if (referrerId === null || referrerId === userId) {
          return
        }

        const bonus = Math.floor((depositPortion * REFERRAL_RATE_PERCENT) / 100)
        if (bonus < 1) {
          return
        }

        const credited = await tx.user.updateMany({
          where: { id: referrerId },
          data: {
            balance: { increment: bonus },
            refEarnings: { increment: bonus },
          },
        })

        if (credited.count === 0) {
          return
        }

        await tx.referralEarning.create({
          data: {
            referrerId,
            referredId: userId,
            amount: bonus,
            sourceType,
            sourceId: sourceId ?? null,
          },
        })

        // История операций: реферальный бонус пригласившему.
        await logTransaction(referrerId, 'REFERRAL', bonus, 'Реферальный бонус', tx)
      },
      { timeout: 10000 },
    )
  } catch (error) {
    console.error('[DEPOSIT] processWagering failed:', error)
  }
}

/* ----------------------------------- DEV ----------------------------------- */

export async function devCredit(
  userId: bigint,
  amount: number,
): Promise<{ ok: true; amount: number }> {
  if (userId !== DEV_TELEGRAM_ID) {
    throw new DepositError('FORBIDDEN', 'Доступно только дев-аккаунту', 403)
  }

  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_DEPOSIT_STARS) {
    throw new DepositError(
      'INVALID_AMOUNT',
      `Сумма должна быть целым числом от 1 до ${MAX_DEPOSIT_STARS} ⭐`,
      400,
    )
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      balance: { increment: amount },
      depositUnspent: { increment: amount },
    },
  })

  return { ok: true, amount }
}

/* --------------------------------- Webhook ---------------------------------- */

export async function setWebhook(publicUrl: string): Promise<boolean> {
  if (!env.WEBHOOK_SECRET) {
    throw new DepositError(
      'WEBHOOK_SECRET_MISSING',
      'WEBHOOK_SECRET не задан в .env сервера',
      500,
    )
  }

  const base = publicUrl.replace(/\/+$/, '')

  return callTelegramApi<boolean>('setWebhook', {
    url: `${base}/api/telegram/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'pre_checkout_query'],
  })
}
