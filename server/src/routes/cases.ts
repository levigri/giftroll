import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { allCases } from '../data/cases.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { getTelegramMarketPrice } from '../services/userbot.js'

export const casesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/cases',
    { preHandler: authenticateTelegram },
    async () => {
      const liveCatalog = await Promise.all(
        nftCatalog.map(async (prize) => ({
          ...prize,
          // Zero means that Telegram currently has no Stars resale floor for this collection.
          price: await getTelegramMarketPrice(prize.name) ?? 0,
        })),
      )
      return { cases: allCases, nftCatalog: liveCatalog }
    },
  )
}
