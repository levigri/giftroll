import { PrismaClient } from '@prisma/client'

// Патч для сериализации BigInt (Telegram ID) в JSON ответов Fastify
;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString()
}

export const prisma = new PrismaClient()
