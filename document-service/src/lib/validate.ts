import { z } from 'zod'
import { NextResponse } from '../shim'

export const zUuid = z.string().uuid()
export const zNonEmpty = z.string().trim().min(1, 'Must not be empty')
export const zCurrency = z.coerce.number().min(0)
export const zPositiveInt = z.number().int().min(1)

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

export function parseBody<T>(schema: z.ZodType<T>, data: unknown, _context?: string): ParseResult<T> {
  const r = schema.safeParse(data)
  if (r.success) return { ok: true, data: r.data }
  const fields: Record<string, string> = {}
  for (const i of r.error.issues) if (i.path.length) fields[i.path.join('.')] = i.message
  return { ok: false, response: NextResponse.json({ error: 'Validation failed', ...(Object.keys(fields).length ? { fields } : {}) }, { status: 400 }) }
}
