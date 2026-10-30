export interface Prize {
  id: string
  name: string
  emoji: string
  type: 'BALANCE' | 'NFT'
  price: number
  chance?: number
}

export interface CaseItem {
  id: string
  name: string
  price: number
  currency: 'STARS' | 'TON'
  emoji: string
  tonPrice?: number
  prizes: Prize[]
  /** Опциональная картинка кейса для модалки открытия. */
  imageUrl?: string
}

export interface CasesResponse {
  cases: CaseItem[]
  /** Каталог целей апгрейдера; в дропе кейсов не участвует. */
  nftCatalog?: Prize[]
}

export interface MeResponse {
  id: string
  firstName: string
  lastName: string | null
  username: string | null
  photoUrl: string | null
  balance: number
  inventoryCount: number
  dailyBonusAvailable: boolean
  /** Когда откроется следующий бесплатный кейс; null — если уже доступен. */
  dailyBonusAvailableAt?: string | null
  /** Неоткрытые бонусные кейсы за депозиты от 200 ⭐. */
  freeCases?: number
  /** Бонусный кейс за депозит уже открыт — карточка скрыта. */
  hasClaimedDepositBonus?: boolean
  /** Итог привязки по реф-ссылке при первом заходе; null — кода не было. */
  referral?: { ok: boolean; reason?: string } | null
  createdAt: string
}

export interface InventoryItem {
  id: string
  userId?: string
  prizeId: string
  prizeName: string
  prizeEmoji: string
  prizePrice: number
  giftId?: string | null
  isExternal: boolean
  lockUntil: string | null
  status: 'PENDING' | 'SENT' | 'CLAIMED' | 'WITHDRAWAL_REQUESTED'
  createdAt: string
}

export interface OpenCaseResponse {
  prize: Prize
  newBalance: number
  caseOpenId: string
}

export interface MultiCaseResultItem {
  prizeId: string
  name: string
  emoji: string
  /** BALANCE — звёзды сразу на баланс, NFT — предмет в инвентарь. */
  type: 'BALANCE' | 'NFT'
  price: number
}

export interface MultiCaseOpenResponse {
  results: MultiCaseResultItem[]
  totalValue: number
  spent: number
  /** Баланс после списания ставки и зачисления звёздных призов. */
  newBalance: number
}

/* ---------- Публичная лента дропов ---------- */

export interface DropEvent {
  id: string
  userId: string
  username: string | null
  eventType: 'case' | 'pvp' | 'upgrader'
  itemName: string
  itemEmoji: string | null
  itemPrice: number
  sourceName: string | null
  sourceEmoji: string | null
  createdAt: string
}

export interface DailyBonusPrize {
  id: string
  label: string
  emoji: string
  amount: number
  type: 'BALANCE' | 'NFT'
}

export interface ClaimDailyResponse {
  prize: DailyBonusPrize
  newBalance: number
  streak: number
}

export interface SellNftResponse {
  newBalance: number
  soldFor: number
}

export interface ClaimNftResponse {
  status: string
}

/* ---------- Пополнение и рефералка ---------- */

export interface DepositInvoiceResponse {
  invoiceLink: string
  depositId: string
}

export interface DepositDevCreditResponse {
  ok: boolean
  amount: number
}

export interface ReferralEarning {
  id: string
  referredId: string
  username: string | null
  firstName: string | null
  amount: number
  sourceType: string
  createdAt: string
}

export type ReferralAttemptStatus = 'success' | 'self_invite' | 'already_bound' | 'invalid'

export interface ReferralInvite {
  id: string
  username: string | null
  firstName: string | null
  createdAt: string
}

export interface ReferralAttempt {
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
  successfulInvites: ReferralInvite[]
  recentAttempts: ReferralAttempt[]
  recentEarnings: ReferralEarning[]
}

/* ---------- Апгрейдер ---------- */

export interface UpgraderTargetNft {
  id: string
  name: string
  emoji: string
  price: number
}

export interface UpgraderResult {
  win: boolean
  /** Выплата при победе (ставка × множитель), при проигрыше — 0. */
  winAmount: number
  multiplier: number
  totalBet: number
  /** Целевой NFT, если выплаты хватило на него; иначе null. */
  receivedNft: UpgraderTargetNft | null
  /** Сколько ⭐ зачислено: вся выплата или сдача после NFT. */
  remainingStars: number
}

/* ---------- PvP «Рулетка на толпу» ---------- */

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

export interface PvpCurrentResponse {
  round: PvpRoundView | null
}

export interface PvpJoinResponse {
  roundId: string
  endsAt: string | null
  round?: PvpRoundView
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

/** Строка истории операций: amount > 0 — доход, < 0 — расход. */
export interface TransactionEntry {
  id: string
  type: 'DEPOSIT' | 'CASE_OPEN' | 'UPGRADE' | 'PVP_BET' | 'PVP_WIN' | 'SELL_NFT' | 'DAILY_BONUS' | 'REFERRAL'
  amount: number
  details: string | null
  createdAt: string
}
