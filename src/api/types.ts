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
  availableAt?: string
  availableUntil?: string
}

export interface CasesResponse {
  cases: CaseItem[]
  /** Каталог целей апгрейдера; в дропе кейсов не участвует. */
  nftCatalog?: Prize[]
}

export interface MeResponse {
  id: string
  isAdmin: boolean
  isBetaMode: boolean
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
  hasClaimedDepositBonus: boolean
  depositBonusOpened: boolean
  /** Итог привязки по реф-ссылке при первом заходе; null — кода не было. */
  referral?: { ok: boolean; reason?: string } | null
  createdAt: string
}

export interface AdminUserSummary {
  id: string
  username: string | null
  firstName: string
  balance: number
  inventoryValue?: number
  totalBalance?: number
  isBetaMode: boolean
  createdAt: string
  inventoryCount?: number
  inventory?: Array<{ prizeName: string; prizeEmoji: string; prizePrice?: number }>
}

export interface AdminDeposit {
  id: string
  amount: number
  currency: string
  status: string
  createdAt: string
  txHash: string | null
  gramsAmount: number | null
}

export interface AdminTransaction {
  id: string
  userId: string
  username: string | null
  firstName: string
  type: string
  amount: number
  details: string | null
  createdAt: string
}

export interface AdminCaseOpen {
  id: string
  caseId: string
  caseName: string
  prizeId: string
  prizeName: string
  prizeEmoji: string
  prizeType: 'BALANCE' | 'NFT'
  prizePrice: number
  isBetaMode: boolean
  createdAt: string
}

export interface AdminUpgraderAttempt {
  id: string
  targetNftId: string
  targetNftName: string
  targetNftEmoji: string
  targetNftPrice: number
  betAmount: number
  chance: number
  win: boolean
  winAmount: number
  isBetaMode: boolean
  createdAt: string
}

export interface AdminActivity {
  id: string
  kind: 'CASE_OPEN' | 'UPGRADE'
  userId: string
  username: string | null
  firstName: string
  title: string
  result: string
  won: boolean
  isBetaMode: boolean
  createdAt: string
}

export interface AdminDepositActivity {
  id: string
  userId: string
  username: string | null
  firstName: string
  amount: number
  currency: string
  createdAt: string
}

export interface AdminPvpActivity {
  id: string
  roundId: string
  userId: string
  username: string | null
  firstName: string
  betAmount: number
  payoutAmount: number
  totalPot: number
  rakeStars: number
  result: string
  outcome: 'WIN' | 'LOSS' | 'REFUND'
  createdAt: string
}

export interface AdminCaseActivity extends AdminActivity {
  kind: 'CASE_OPEN'
  casePrice: number
  prizeName: string
  prizeEmoji: string
  prizeType: 'BALANCE' | 'NFT'
  prizePrice: number
}

export interface AdminUpgradeActivity extends AdminActivity {
  kind: 'UPGRADE'
  betAmount: number
  targetNftName: string
  targetNftEmoji: string
  targetNftPrice: number
  winAmount: number
  chance: number
}

export interface AdminHistoryResponse {
  deposits: AdminDepositActivity[]
  pvp: AdminPvpActivity[]
  cases: AdminCaseActivity[]
  upgrades: AdminUpgradeActivity[]
}

export interface AdminTask {
  id: string
  title: string
  description: string
  reward: number
  emoji: string
  type: 'channel_subscription' | 'amateur_case' | 'nickname_streak' | 'first_upgrade' | 'first_pvp' | 'daily_streak_7' | 'active_referral'
  target?: number
  channelUsername: string | null
  maxCompletions: number | null
  completedByCount: number
  active: boolean
}

export interface AdminUserDetails {
  user: AdminUserSummary & {
    lastName: string | null
    photoUrl: string | null
    depositUnspent: number
    referredBy: string | null
    refCode: string
    updatedAt: string
  }
  inventory: InventoryItem[]
  deposits: AdminDeposit[]
  transactions: Array<Pick<AdminTransaction, 'id' | 'type' | 'amount' | 'details' | 'createdAt'>>
  caseOpens: AdminCaseOpen[]
  upgraderAttempts: AdminUpgraderAttempt[]
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

export interface ClaimDepositBonusResponse {
  prize: DailyBonusPrize
  newBalance: number
}

export interface PromoCheckResponse {
  valid: boolean
  error?: string
}

export interface PromoOpenResponse {
  prize: DailyBonusPrize
  newBalance: number
  currentUses: number
}

export interface SellNftResponse {
  newBalance: number
  soldFor: number
}

export interface ClaimNftResponse {
  status: string
}

export interface TaskItem {
  id: string
  title: string
  description: string
  reward: number
  emoji: string
  completed: boolean
  claimed: boolean
  progressCurrent?: number
  progressTarget?: number
  completedByCount?: number
  maxCompletions?: number | null
  available: boolean
  type: AdminTask['type']
  channelUsername?: string | null
}

export interface TasksResponse {
  tasks: TaskItem[]
}

export interface ClaimTaskResponse {
  ok: boolean
  reward: number
  newBalance: number
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
  type: 'DEPOSIT' | 'CASE_OPEN' | 'UPGRADE' | 'PVP_BET' | 'PVP_WIN' | 'SELL_NFT' | 'DAILY_BONUS' | 'REFERRAL' | 'TASK_REWARD'
  amount: number
  details: string | null
  createdAt: string
}
