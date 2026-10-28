import 'fastify'
import type { User } from '@prisma/client'
import type { ReferralBindResult } from '../services/referral.js'

declare module 'fastify' {
  interface FastifyRequest {
    telegramUser?: User
    /** Итог привязки по X-Ref-Code в этом запросе (ошибку показываем на фронте). */
    referralBind?: ReferralBindResult
  }
}
