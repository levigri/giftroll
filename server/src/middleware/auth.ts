import type { FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '@prisma/client'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'
import { parseInitData, upsertUserFromTelegram } from '../utils/telegram.js'
import { bindReferrer } from '../services/referral.js'

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Upsert пользователя + привязка реферера при первом создании.
 * Реферальный код читается только для нового аккаунта: перепривязка невозможна.
 */
async function upsertWithReferral(
  request: FastifyRequest,
  tg: Parameters<typeof upsertUserFromTelegram>[0],
): Promise<User> {
  const refCode = headerValue(request, 'x-ref-code')

  let user = await upsertUserFromTelegram(tg)

  // Код пришёл — всегда пробуем привязать и запоминаем итог.
  // Ошибку (свой код, уже привязан, битый код) фронт показывает при входе,
  // а сама попытка попадает в ReferralAttempt для лога на странице «Друзья».
  if (refCode) {
    try {
      const result = await bindReferrer(user.id, refCode)
      request.referralBind = result

      if (result.ok) {
        const freshUser = await prisma.user.findUnique({ where: { id: user.id } })
        if (freshUser) {
          user = freshUser
        }
      } else {
        request.log.warn(
          `[AUTH] referral not bound for user=${user.id.toString()}: ${result.reason}`,
        )
      }
    } catch (error) {
      request.log.warn(error, '[AUTH] bindReferrer failed')
    }
  }

  return user
}

/**
 * Middleware аутентификации Telegram Mini App.
 * Проверяет подпись initData в заголовке Authorization: "tma <initData>"
 * В dev-режиме поддерживает обход через заголовок X-Dev-Telegram-Id.
 */
export async function authenticateTelegram(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    // 1. Dev-bypass для локального тестирования без Telegram клиента
    const devIdHeader = request.headers['x-dev-telegram-id']
    if (env.NODE_ENV !== 'production' && devIdHeader) {
      const devIdStr = Array.isArray(devIdHeader) ? devIdHeader[0] : devIdHeader
      const trimmed = devIdStr.trim()

      if (/^\d+$/.test(trimmed)) {
        const user = await upsertWithReferral(request, {
          id: BigInt(trimmed),
          firstName: 'Dev User',
        })
        request.telegramUser = user
        request.log.warn(`[AUTH] dev-bypass id=${trimmed}`)
        return
      }
    }

    // 2. Проверка заголовка Authorization: "tma <initData>"
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('tma ')) {
      return reply.code(401).send({
        error: 'Missing or invalid Authorization header',
        code: 'AUTH_MISSING',
      })
    }

    const rawInitData = authHeader.slice(4).trim()
    if (!rawInitData) {
      return reply.code(401).send({
        error: 'Missing or invalid Authorization header',
        code: 'AUTH_MISSING',
      })
    }

    // 3. Валидация подписи initData и срока действия
    const parsed = parseInitData(rawInitData)
    if (!parsed) {
      return reply.code(401).send({
        error: 'Invalid initData signature or expired',
        code: 'AUTH_INVALID',
      })
    }

    // 4. Upsert пользователя в БД (+ реферер, если аккаунт создаётся впервые)
    const user = await upsertWithReferral(request, parsed.user)
    request.telegramUser = user

    request.log.info(
      `[AUTH] user=${user.id.toString()}${user.username ? ` username=@${user.username}` : ''}`,
    )
  } catch (error) {
    request.log.error(error, '[AUTH] Unexpected error during authentication')
    return reply.code(500).send({
      error: 'Authentication failed',
      code: 'AUTH_INTERNAL_ERROR',
    })
  }
}
