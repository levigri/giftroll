import type {
  CasesResponse,
  ClaimDailyResponse,
  ClaimNftResponse,
  DropEvent,
  InventoryItem,
  MeResponse,
  MultiCaseOpenResponse,
  OpenCaseResponse,
  PvpCurrentResponse,
  PvpHistoryEntry,
  PvpJoinResponse,
  PvpRoundView,
  ReferralStats,
  SellNftResponse,
  TransactionEntry,
  UpgraderResult,
} from './types'
import { getInitData, getStoredRefCode } from '../telegram'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Реферальный код из start_param (localStorage['ref_code']).
 * Прикрепляем его к каждому запросу — сервер сам решает, привязывать ли реферера.
 */
function refHeaders(): Record<string, string> {
  const refCode = getStoredRefCode()
  return refCode ? { 'X-Ref-Code': refCode } : {}
}

export function authHeaders(): Record<string, string> {
  const initData = getInitData().trim()
  if (initData) {
    return { Authorization: `tma ${initData}` }
  }

  if (import.meta.env.DEV) {
    const devId = (import.meta.env.VITE_DEV_TELEGRAM_ID as string | undefined) || '11111111'
    return { 'X-Dev-Telegram-Id': devId }
  }

  return {}
}

async function request<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const headers: Record<string, string> = {
    // Telegram WebView кэширует ответы API — гоняем кэш при каждой загрузке.
    'Cache-Control': 'no-cache',
    ...(auth ? authHeaders() : {}),
    ...refHeaders(),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  }

  if (init?.body !== undefined && init.body !== null) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })

  if (!res.ok) {
    let errorCode = 'UNKNOWN_ERROR'
    let errorMessage = `HTTP error ${res.status}`

    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        if (body.code) errorCode = String(body.code)
        if (body.error) errorMessage = String(body.error)
      }
    } catch {
      // not JSON
    }

    throw new ApiError(errorCode, errorMessage, res.status)
  }

  return res.json() as Promise<T>
}

export async function getMe(): Promise<MeResponse> {
  // ref_code НЕ удаляем: он нужен как для повторных запросов, так и для
  // блока диагностики на странице «Друзья». Повторные попытки привязки
  // сервер дедуплицирует кэшем.
  return request<MeResponse>('/api/me')
}

export async function getCases(): Promise<CasesResponse> {
  return request<CasesResponse>('/api/cases')
}

export async function openCase(caseId: string): Promise<OpenCaseResponse> {
  return request<OpenCaseResponse>('/api/open-case', {
    method: 'POST',
    body: JSON.stringify({ caseId }),
  })
}

export async function openMultiCase(
  caseId: string,
  count: 2 | 5,
): Promise<MultiCaseOpenResponse> {
  return request<MultiCaseOpenResponse>('/api/open-multi-case', {
    method: 'POST',
    body: JSON.stringify({ caseId, count }),
  })
}

/** Публичная лента дропов — без auth-заголовков. */
export async function getDropsFeed(limit = 30): Promise<DropEvent[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
  return request<DropEvent[]>(`/api/drops/feed?limit=${safeLimit}`, undefined, false)
}

export async function getInventory(): Promise<{ items: InventoryItem[] }> {
  return request<{ items: InventoryItem[] }>('/api/inventory')
}

export async function sellNft(id: string): Promise<SellNftResponse> {
  return request<SellNftResponse>(`/api/nft/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function claimNft(id: string): Promise<ClaimNftResponse> {
  return request<ClaimNftResponse>(`/api/nft/${encodeURIComponent(id)}/claim`, {
    method: 'POST',
  })
}

export async function claimDaily(): Promise<ClaimDailyResponse> {
  return request<ClaimDailyResponse>('/api/claim-daily', {
    method: 'POST',
  })
}

/* ---------- PvP «Рулетка на толпу» ---------- */

/** Текущее лобби (polling раз в секунду). */
export async function pvpGetCurrent(): Promise<PvpCurrentResponse> {
  return request<PvpCurrentResponse>('/api/pvp/current')
}

/** Войти в общее лобби со ставкой stars. */
export async function pvpJoin(stars: number): Promise<PvpJoinResponse> {
  return request<PvpJoinResponse>('/api/pvp/join', {
    method: 'POST',
    body: JSON.stringify({ stars }),
  })
}

/** Докинуть ⭐ к своей ставке, пока раунд открыт. */
export async function pvpAddBet(
  roundId: string,
  extraStars: number,
): Promise<{ ok: boolean; round?: PvpRoundView }> {
  return request<{ ok: boolean; round?: PvpRoundView }>('/api/pvp/add-bet', {
    method: 'POST',
    body: JSON.stringify({ roundId, extraStars }),
  })
}

/** Последние сыгранные раунды игрока. */
export async function pvpGetHistory(): Promise<PvpHistoryEntry[]> {
  return request<PvpHistoryEntry[]>('/api/pvp/history')
}

/* ---------- Апгрейдер ---------- */

/** Ставка ⭐ + NFT на выбранный шанс (1–80%) с целью в виде NFT из кейсов. */
export async function upgraderUpgrade(
  nftIds: string[],
  starsBet: number,
  chance: number,
  targetNftId: string,
): Promise<UpgraderResult> {
  return request<UpgraderResult>('/api/upgrader/upgrade', {
    method: 'POST',
    body: JSON.stringify({ nftIds, starsBet, chance, targetNftId }),
  })
}

/* ---------- Пополнение баланса ---------- */

/** Создаёт инвойс Telegram Stars на amount ⭐. */
export async function depositCreateInvoice(
  amount: number,
): Promise<{ invoiceLink: string; depositId: string }> {
  return request<{ invoiceLink: string; depositId: string }>('/api/deposit/invoice', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

/** Счёт @CryptoBot (Crypto Pay) на amount ⭐ — открывается в Telegram. */
export async function depositCryptoInvoice(amount: number): Promise<{ invoiceLink: string }> {
  return request<{ invoiceLink: string }>('/api/deposit/crypto/invoice', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

/**
 * Депозит в Grams: игрок указывает, сколько звёзд хочет получить,
 * сервер считает сумму в Gram по живому курсу CoinGecko.
 */
export async function depositGramsInvoice(starsAmount: number): Promise<{
  depositId: string
  gramsAmount: number
  starsAmount: number
  receiverAddress: string
}> {
  return request<{
    depositId: string
    gramsAmount: number
    starsAmount: number
    receiverAddress: string
  }>('/api/deposit/grams/invoice', {
    method: 'POST',
    body: JSON.stringify({ starsAmount }),
  })
}

/** Базовый курс звёзд ($1.40 за 100 ⭐) и живой курс TON в USD. */
export async function getDepositRates(): Promise<{ starsUsd: number; tonUsd: number }> {
  return request<{ starsUsd: number; tonUsd: number }>('/api/deposit/rates', { method: 'GET' })
}

export async function depositGramsConfirm(
  depositId: string,
  transactionBoc: string,
): Promise<{ ok: boolean; starsAmount?: number }> {
  return request<{ ok: boolean; starsAmount?: number }>('/api/deposit/grams/confirm', {
    method: 'POST',
    body: JSON.stringify({ depositId, transactionBoc }),
  })
}

/** ⚠️ DEV ONLY — мгновенное пополнение без оплаты (только дев-аккаунт). */
export async function depositDevCredit(
  amount: number,
): Promise<{ ok: boolean; amount: number }> {
  return request<{ ok: boolean; amount: number }>('/api/deposit/dev-credit', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  })
}

// TEMPORARY MOCK FOR TESTING - REMOVE BEFORE RELEASE
export async function depositMock50(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/deposit/mock-50', {
    method: 'POST',
  })
}

/* ---------- Рефералка ---------- */

export async function getReferralStats(): Promise<ReferralStats> {
  return request<ReferralStats>('/api/referral/stats')
}

/** История операций по балансу: новые сверху, пачками по `limit`. */
export async function getTransactions(limit = 30): Promise<TransactionEntry[]> {
  return request<TransactionEntry[]>(`/api/transactions?limit=${limit}`)
}
