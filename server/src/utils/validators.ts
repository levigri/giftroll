import { z } from 'zod'

export const openCaseSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
})

export const openMultiCaseSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
  count: z.union([z.literal(2), z.literal(5)]),
})

export const claimNftSchema = z.object({}).passthrough()

export type OpenCaseInput = z.infer<typeof openCaseSchema>
export type OpenMultiCaseInput = z.infer<typeof openMultiCaseSchema>

export function parseBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    const errorMsg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', ')
    return { ok: false, error: errorMsg }
  }
  return { ok: true, data: result.data }
}
