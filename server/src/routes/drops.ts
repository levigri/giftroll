import type { FastifyPluginAsync } from 'fastify'
import { getFeed, toDropView } from '../services/drops.js'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/**
 * Публичная лента дропов. Без auth: её видят все, включая гостей.
 * GET /api/drops/feed?limit=30
 */
export const dropsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/drops/feed', async (request) => {
    const raw = (request.query as { limit?: string | number } | undefined)?.limit
    const parsed = Number(raw)
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT)
      : DEFAULT_LIMIT

    const drops = await getFeed(limit)
    return drops.map(toDropView)
  })
}
