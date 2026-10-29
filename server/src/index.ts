import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import { env } from './config/env.js'
import { prisma } from './db/prisma.js'
import { GameError } from './services/game.js'
import { healthRoutes } from './routes/health.js'
import { meRoutes } from './routes/me.js'
import { casesRoutes } from './routes/cases.js'
import { openCaseRoutes } from './routes/openCase.js'
import { inventoryRoutes } from './routes/inventory.js'
import { dailyBonusRoutes } from './routes/dailyBonus.js'
import { pvpRoutes } from './routes/pvp.js'
import { upgraderRoutes } from './routes/upgrader.js'
import { dropsRoutes } from './routes/drops.js'
import { depositRoutes } from './routes/deposit.js'
import { telegramRoutes } from './routes/telegram.js'
import { referralRoutes } from './routes/referral.js'
import { devRoutes } from './routes/dev.js'
import { initUserbot, stopUserbot } from './services/userbot.js'

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
    error: error.message || 'Internal server error',
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
await fastify.register(healthRoutes)
await fastify.register(meRoutes)
await fastify.register(casesRoutes)
await fastify.register(openCaseRoutes)
await fastify.register(inventoryRoutes)
await fastify.register(dailyBonusRoutes)
await fastify.register(pvpRoutes)
await fastify.register(upgraderRoutes)
await fastify.register(dropsRoutes)
await fastify.register(depositRoutes)
await fastify.register(telegramRoutes)
await fastify.register(referralRoutes)
await fastify.register(devRoutes)

// Отключение от БД при остановке сервера
fastify.addHook('onClose', async () => {
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

  // Telegram Userbot is optional: a connection/configuration error must not stop Fastify.
  try {
    await initUserbot()
  } catch (error) {
    fastify.log.error(error, '[Userbot] Ошибка инициализации. Сервер продолжает работу.')
  }
}

void start()
