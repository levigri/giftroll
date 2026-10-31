import type { FastifyPluginAsync } from 'fastify'
import { Bot, Context, webhookCallback } from 'grammy'
import { env } from '../config/env.js'
import { prisma } from '../db/prisma.js'

export const supportBot: Bot | null = env.SUPPORT_BOT_TOKEN
  ? new Bot(env.SUPPORT_BOT_TOKEN)
  : null

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5
const userMsgTimes = new Map<string, number[]>()

function allowRate(userId: string): boolean {
  const now = Date.now()
  const times = (userMsgTimes.get(userId) ?? []).filter((time) => now - time < RATE_WINDOW_MS)
  if (times.length >= RATE_MAX) {
    userMsgTimes.set(userId, times)
    return false
  }
  times.push(now)
  userMsgTimes.set(userId, times)
  return true
}

function isAdmin(userId: number | undefined): boolean {
  if (env.ADMIN_ID === undefined || userId === undefined) return false
  return BigInt(userId) === env.ADMIN_ID
}

function mediaTypeOf(message: Context['message']): string | null {
  if (!message) return null
  if (message.photo) return 'photo'
  if (message.video) return 'video'
  if (message.voice) return 'voice'
  if (message.audio) return 'audio'
  if (message.animation) return 'animation'
  if (message.sticker) return 'sticker'
  if (message.video_note) return 'video_note'
  if (message.document) return 'document'
  return null
}

function userHeader(from: {
  id: number
  first_name: string
  last_name?: string
  username?: string
}): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ')
  const handle = from.username ? `@${from.username}` : 'без username'
  return `📩 Новое обращение в поддержку\n\nОт: ${name}\n${handle}\nID: ${from.id}\n\n↩️ Ответь Reply на следующее сообщение, чтобы отправить ответ юзеру.`
}

async function handleStart(ctx: Context): Promise<void> {
  await ctx
    .reply(
      '👋 Это бот поддержки GiftRoll.\n\n' +
        'Напиши свой вопрос одним сообщением — передам в поддержку. ' +
        'Можно прикрепить скриншот или фото. Обычно отвечаем в течение дня.',
    )
    .catch(() => {})
}

async function handleUserMessage(ctx: Context): Promise<void> {
  if (!supportBot || env.ADMIN_ID === undefined) return
  const from = ctx.from
  const message = ctx.message
  const chat = ctx.chat
  if (!from || !message || !chat) return

  if (!allowRate(String(from.id))) {
    await ctx.reply('Слишком много сообщений подряд. Подожди минуту.').catch(() => {})
    return
  }

  try {
    const userId = BigInt(from.id)
    await ctx.api.sendMessage(env.ADMIN_ID.toString(), userHeader(from))
    const copied = await ctx.api.copyMessage(
      env.ADMIN_ID.toString(),
      chat.id,
      message.message_id,
    )

    await prisma.supportMessage.create({
      data: {
        userId,
        direction: 'in',
        adminMessageId: copied.message_id,
        text: typeof message.text === 'string' ? message.text.slice(0, 2000) : null,
        mediaType: mediaTypeOf(message),
      },
    })

    await ctx
      .reply('✅ Сообщение передано в поддержку. Обычно отвечаем в течение дня.')
      .catch(() => {})
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'unknown error'
    console.error(`[Support] forward to admin failed (${errorName})`)
    await ctx.reply('Не удалось передать сообщение в поддержку. Попробуй позже.').catch(() => {})
  }
}

async function handleAdminReply(ctx: Context): Promise<void> {
  const message = ctx.message
  const replyTo = message?.reply_to_message
  const chat = ctx.chat
  if (!replyTo || !message || !chat) {
    await ctx
      .reply('Используй Reply на скопированное обращение юзера — тогда я знаю, кому отвечать.')
      .catch(() => {})
    return
  }

  const record = await prisma.supportMessage.findUnique({
    where: { adminMessageId: replyTo.message_id },
  })

  if (!record || record.direction !== 'in') {
    await ctx
      .reply(
        'Не нашёл, кому это адресовано. Reply нужен именно на КОПИЮ обращения юзера (не на шапку «📩 Новое обращение»).',
      )
      .catch(() => {})
    return
  }

  try {
    await ctx.api.copyMessage(record.userId.toString(), chat.id, message.message_id)
    await prisma.supportMessage.create({
      data: {
        userId: record.userId,
        direction: 'out',
        text: typeof message.text === 'string' ? message.text.slice(0, 2000) : null,
        mediaType: mediaTypeOf(message),
      },
    })
    await ctx.react('👍').catch(() => {})
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'unknown error'
    console.error(`[Support] reply to user failed (${errorName})`)
    await ctx.reply('❌ Не доставлено. Возможно, юзер заблокировал бота.').catch(() => {})
  }
}

if (supportBot) {
  if (env.ADMIN_ID === undefined) {
    console.warn('[Support] ADMIN_ID не задан — переписка отключена, но бот принимает /start')
  }

  supportBot.command('start', handleStart)
  supportBot.command('help', async (ctx) => {
    await ctx.reply('Напиши свой вопрос одним сообщением — передам в поддержку.').catch(() => {})
  })

  supportBot.on('message', async (ctx, next) => {
    if (env.ADMIN_ID === undefined) {
      console.warn('[Support] message received but ADMIN_ID is not configured')
      await ctx.reply('Поддержка временно недоступна. Попробуй написать позже.').catch(() => {})
      return next()
    }
    if (isAdmin(ctx.from?.id)) {
      await handleAdminReply(ctx)
      return
    }
    await handleUserMessage(ctx)
  })
}

export const supportRoutes: FastifyPluginAsync = async (fastify) => {
  if (!supportBot) {
    fastify.log.warn('[Support] supportRoutes без supportBot — вебхук отключён')
    return
  }

  const secret = env.SUPPORT_WEBHOOK_SECRET ?? env.WEBHOOK_SECRET
  const handleUpdate = webhookCallback(supportBot, 'fastify', { secretToken: secret })

  fastify.post('/api/support/webhook', async (request, reply) => {
    const provided = request.headers['x-telegram-bot-api-secret-token']
    const providedStr = Array.isArray(provided) ? provided[0] : provided
    if (secret && providedStr !== secret) {
      request.log.warn('[Support] rejected webhook: invalid secret token')
      return reply.code(403).send({ ok: false })
    }

    try {
      await handleUpdate(request, reply)
    } catch (error) {
      request.log.error(error, '[Support] grammY update failed')
      throw error
    }
    return reply
  })
}

export async function setupSupportWebhook(publicBaseUrl: string): Promise<boolean> {
  if (!supportBot) return false
  const base = publicBaseUrl.replace(/\/+$/, '')
  const secret = env.SUPPORT_WEBHOOK_SECRET ?? env.WEBHOOK_SECRET
  try {
    const botInfo = await supportBot.api.getMe()
    const actualUsername = botInfo.username?.toLowerCase()
    if (actualUsername !== 'giftrollsuport') {
      console.error(
        `[Support] SUPPORT_BOT_TOKEN belongs to @${botInfo.username ?? 'unknown'}; expected @Giftrollsuport`,
      )
      return false
    }

    console.info('[Support] token verified for @Giftrollsuport')
    await supportBot.api.setWebhook(`${base}/api/support/webhook`, {
      ...(secret ? { secret_token: secret } : {}),
      allowed_updates: ['message'],
    })
    return true
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'unknown error'
    console.error(`[Support] setupWebhook failed (${errorName})`)
    return false
  }
}
