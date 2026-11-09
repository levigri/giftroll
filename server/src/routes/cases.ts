import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { allCases, LIMITED_CASE_AVAILABLE_AT, LIMITED_CASE_AVAILABLE_UNTIL } from '../data/cases.js'
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
          // Keep the catalog price available when both live sources are offline.
          price: await getTelegramMarketPrice(prize.name) ?? prize.price,
        })),
      )
      const cases = allCases.map((caseItem) => caseItem.id === 'case-limited'
        ? {
            ...caseItem,
            availableAt: new Date(LIMITED_CASE_AVAILABLE_AT).toISOString(),
            availableUntil: new Date(LIMITED_CASE_AVAILABLE_UNTIL).toISOString(),
          }
        : caseItem)
      return { cases, nftCatalog: liveCatalog }
    },
  )
}
