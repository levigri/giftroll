import { parse, validate } from '@tma.js/init-data-node'
import type { User } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { env } from '../config/env.js'

export interface TelegramInitDataUser {
  id: number
  firstName: string
  lastName?: string
  username?: string
  photoUrl?: string
}

export interface ParsedInitData {
  user: TelegramInitDataUser
  authDate: Date
  queryId?: string
}

/**
 * Валидирует и парсит raw initData от Telegram Mini App.
 * Проверяет подпись бота и срок действия (auth_date не старше 1 часа).
 * Возвращает распарсенные данные или null при ошибке/истечении срока.
 */
export function parseInitData(raw: string): ParsedInitData | null {
  try {
    validate(raw, env.BOT_TOKEN, { expiresIn: 3600 })
    const parsed = parse(raw)
    if (!parsed.user) {
      return null
    }

    return {
      user: {
        id: parsed.user.id,
        firstName: parsed.user.first_name,
        lastName: parsed.user.last_name,
        username: parsed.user.username,
        photoUrl: parsed.user.photo_url,
      },
      authDate: parsed.auth_date,
      queryId: parsed.query_id,
    }
  } catch {
    return null
  }
}

/**
 * Создаёт нового пользователя с приветственным балансом или обновляет данные существующего.
 */
export async function upsertUserFromTelegram(tg: {
  id: number | bigint
  firstName: string
  lastName?: string | null
  username?: string | null
  photoUrl?: string | null
}): Promise<User> {
  const telegramId = BigInt(tg.id)

  return prisma.user.upsert({
    where: { id: telegramId },
    update: {
      firstName: tg.firstName,
      lastName: tg.lastName ?? null,
      username: tg.username ?? null,
      photoUrl: tg.photoUrl ?? null,
    },
    create: {
      id: telegramId,
      firstName: tg.firstName,
      lastName: tg.lastName ?? null,
      username: tg.username ?? null,
      photoUrl: tg.photoUrl ?? null,
      balance: env.WELCOME_BONUS,
    },
  })
}
