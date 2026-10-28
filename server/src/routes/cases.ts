import type { FastifyPluginAsync } from 'fastify'
import { authenticateTelegram } from '../middleware/auth.js'
import { allCases } from '../data/cases.js'
import { nftCatalog } from '../data/nftCatalog.js'

export const casesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/cases',
    { preHandler: authenticateTelegram },
    async () => {
      return { cases: allCases, nftCatalog }
    },
  )
}
