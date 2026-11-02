import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { allCases } from '../data/cases.js'
import { nftCatalog } from '../data/nftCatalog.js'
import { getCurrentNftPriceInStars } from '../services/giftAssetPricing.js'

export const casesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/cases',
    { preHandler: authenticateTelegram },
    async () => {
      const liveCatalog = await Promise.all(
        nftCatalog.map(async (prize) => ({
          ...prize,
          // 0 means neither GiftAsset nor Telegram has a usable live quote.
          price: await getCurrentNftPriceInStars(prize.name) ?? 0,
        })),
      )
      return { cases: allCases, nftCatalog: liveCatalog }
    },
  )
}
