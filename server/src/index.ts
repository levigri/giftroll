import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import websocket from '@fastify/websocket'
import { env } from './config/env.js'
import { prisma } from './db/prisma.js'
import { GameError } from './services/game.js'
import { healthRoutes } from './routes/health.js'
import { meRoutes } from './routes/me.js'
import { casesRoutes } from './routes/cases.js'
import { openCaseRoutes } from './routes/openCase.js'
import { inventoryRoutes } from './routes/inventory.js'
import { dailyBonusRoutes } from './routes/dailyBonus.js'
import { promoRoutes } from './routes/promo.js'
import { pvpRoutes } from './routes/pvp.js'
import { upgraderRoutes } from './routes/upgrader.js'
import { dropsRoutes } from './routes/drops.js'
import { depositRoutes } from './routes/deposit.js'
import { telegramRoutes } from './routes/telegram.js'
import { referralRoutes } from './routes/referral.js'
import { devRoutes } from './routes/dev.js'
import { tasksRoutes } from './routes/tasks.js'
import { setupSupportWebhook, supportBot, supportRoutes } from './routes/support.js'
import { initUserbot, stopUserbot } from './services/userbot.js'
import { notifyDailyBonusReady } from './services/bot.js'
import { checkNicknameTask } from './services/nickname.js'
import { getPriceSnapshot, startPricePoller, stopPricePoller, subscribePriceUpdates } from './services/pricePoller.js'

const DAILY_REMINDER_INTERVAL_MS = 30 * 60 * 1000
const DAILY_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000
const DAILY_REMINDER_BATCH_LIMIT = 500
const DAILY_REMINDER_DELAY_MS = 50
const NICKNAME_SWEEP_INTERVAL_MS = 30 * 60 * 1000
const NFT_WITHDRAWAL_RETRY_INTERVAL_MS = 5 * 60 * 1000

let reminderRunning = false
let reminderTimer: ReturnType<typeof setInterval> | undefined
let nicknameSweepRunning = false
let nicknameSweepTimer: ReturnType<typeof setInterval> | undefined
let withdrawalRetryTimer: ReturnType<typeof setInterval> | undefined
let lastNicknameSweepDay: string | null = null

function todayUtcString(): string {
  return new Date().toISOString().slice(0, 10)
}

async function sendDailyCaseReminders(): Promise<void> {
  if (reminderRunning) return
  reminderRunning = true

  try {
    const cutoff = new Date(Date.now() - DAILY_REMINDER_WINDOW_MS)
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { OR: [{ notifiedAt: null }, { notifiedAt: { lt: cutoff } }] },
          {
            OR: [
              { dailyBonus: { is: null } },
              { dailyBonus: { is: { lastClaimedAt: { lt: cutoff } } } },
            ],
          },
        ],
      },
      select: { id: true },
      take: DAILY_REMINDER_BATCH_LIMIT,
    })

    for (let index = 0; index < users.length; index += 1) {
      const user = users[index]
      try {
        const sent = await notifyDailyBonusReady(user.id)
        if (sent) {
          await prisma.user.update({ where: { id: user.id }, data: { notifiedAt: new Date() } })
        }
      } catch (err) {
        fastify.log.error(err, `[Reminder] failed for user ${user.id}`)
      }

      if (index < users.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DAILY_REMINDER_DELAY_MS))
      }
    }
  } finally {
    reminderRunning = false
  }
}

async function runNicknameSweepIfNeeded(): Promise<void> {
  const today = todayUtcString()
  if (lastNicknameSweepDay === today || nicknameSweepRunning) return
  nicknameSweepRunning = true

  try {
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { nicknameStreakDays: { lt: 7 } },
          { OR: [{ nicknameCheckedAt: null }, { nicknameCheckedAt: { lt: todayStart } }] },
          { updatedAt: { gt: thirtyDaysAgo } },
        ],
      },
      select: { id: true },
    })

    for (const user of users) {
      try {
        await checkNicknameTask(user.id, true)
      } catch (err) {
        console.error(`[NicknameSweep] user=${user.id} failed:`, err)
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    lastNicknameSweepDay = today
  } finally {
    nicknameSweepRunning = false
  }
}

const fastify = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
})

// Настройка middleware
await fastify.register(cors, {
  origin: true,
})
await fastify.register(formbody)
await fastify.register(websocket)

// Единый обработчик ошибок
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof GameError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    })
  }

  request.log.error(error)
  reply.code(500).send({
    error: error instanceof Error ? error.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
  })
})

// 404 обработчик
fastify.setNotFoundHandler((_request, reply) => {
  reply.code(404).send({
    error: 'Not found',
    code: 'NOT_FOUND',
  })
})

// Регистрация эндпоинтов
fastify.get('/api/prices/stream', { websocket: true }, (socket) => {
  socket.send(JSON.stringify(getPriceSnapshot()))
  const unsubscribe = subscribePriceUpdates((message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message))
  })
  socket.on('close', unsubscribe)
  socket.on('error', unsubscribe)
})

await fastify.register(healthRoutes)
await fastify.register(meRoutes)
await fastify.register(casesRoutes)
await fastify.register(openCaseRoutes)
await fastify.register(inventoryRoutes)
await fastify.register(dailyBonusRoutes)
await fastify.register(promoRoutes)
await fastify.register(pvpRoutes)
await fastify.register(upgraderRoutes)
await fastify.register(dropsRoutes)
await fastify.register(depositRoutes)
await fastify.register(telegramRoutes)
await fastify.register(supportRoutes)
await fastify.register(referralRoutes)
await fastify.register(tasksRoutes)
await fastify.register(devRoutes)

// Отключение от БД при остановке сервера
fastify.addHook('onClose', async () => {
  if (reminderTimer) clearInterval(reminderTimer)
  if (nicknameSweepTimer) clearInterval(nicknameSweepTimer)
  if (withdrawalRetryTimer) clearInterval(withdrawalRetryTimer)
  stopPricePoller()
  await stopUserbot()
  await prisma.$disconnect()
})

// Graceful shutdown
const handleShutdown = async (signal: string) => {
  fastify.log.info(`[Server] Received ${signal}, shutting down...`)
  await fastify.close()
  process.exit(0)
}

process.on('SIGINT', () => void handleShutdown('SIGINT'))
process.on('SIGTERM', () => void handleShutdown('SIGTERM'))

// Запуск сервера
const start = async () => {
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
    fastify.log.info(`[Server] listening on http://0.0.0.0:${env.PORT}`)
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }

  void sendDailyCaseReminders().catch((err) => fastify.log.error(err, '[Reminder] failed'))
  reminderTimer = setInterval(() => {
    void sendDailyCaseReminders().catch((err) => fastify.log.error(err, '[Reminder] failed'))
  }, DAILY_REMINDER_INTERVAL_MS)
  reminderTimer.unref()
  void runNicknameSweepIfNeeded().catch((err) => fastify.log.error(err, '[NicknameSweep] failed'))
  nicknameSweepTimer = setInterval(() => {
    void runNicknameSweepIfNeeded().catch((err) => fastify.log.error(err, '[NicknameSweep] failed'))
  }, NICKNAME_SWEEP_INTERVAL_MS)
  nicknameSweepTimer.unref()

  // Telegram Userbot is optional: a connection/configuration error must not stop Fastify.
  try {
    await initUserbot()
  } catch (error) {
    fastify.log.error(error, '[Userbot] Ошибка инициализации. Сервер продолжает работу.')
  }
  // Автоотправка NFT отключена (вывод обрабатывается вручную админом)
  // void retryPendingWithdrawals().catch(...)
  startPricePoller()

  if (supportBot && env.WEBHOOK_URL) {
    const ok = await setupSupportWebhook(env.WEBHOOK_URL)
    if (ok) {
      fastify.log.info(`[Support] webhook установлен: ${env.WEBHOOK_URL.replace(/\/+$/, '')}/api/support/webhook`)
    } else {
      fastify.log.error('[Support] не удалось установить webhook — проверь SUPPORT_BOT_TOKEN и WEBHOOK_URL')
    }
  }
}

void start()
