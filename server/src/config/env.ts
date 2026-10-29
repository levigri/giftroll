import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  WELCOME_BONUS: z.coerce.number().default(1000),
  WEBHOOK_URL: z.string().optional(),
  /** Секрет Telegram webhook: сверяется с X-Telegram-Bot-Api-Secret-Token. */
  WEBHOOK_SECRET: z.string().optional(),
  /** Адрес кошелька-получателя для пополнений в Gram (TON mainnet). */
  TON_RECEIVER_ADDRESS: z.string().min(1, 'TON_RECEIVER_ADDRESS is required'),
  /** Токен бота @CryptoBot (Crypto Pay API) для оплаты криптой. */
  CRYPTO_PAY_TOKEN: z.string().optional(),
  /** MTProto credentials для принимающего Telegram аккаунта (Userbot). */
  TELEGRAM_API_ID: z.coerce.number().int().positive().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  /** StringSession выдаётся локальным scripts/generate-session.ts; хранить только в env. */
  TELEGRAM_SESSION: z.string().optional(),
})

const parsed = envSchema.parse(process.env)

export const env = parsed
export type Env = z.infer<typeof envSchema>
