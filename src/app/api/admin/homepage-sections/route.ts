import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, withTransaction } from '@/lib/db'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'
import { SECTION_TYPES } from '@/lib/homepage-sections'

export const dynamic = 'force-dynamic'

async function guard(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const denied = await guard(request)
  if (denied) return denied
  const sections = await queryMany(
    `SELECT * FROM homepage_sections ORDER BY display_order ASC, created_at ASC`
  )
  return NextResponse.json({ sections })
}

const bodySchema = z.object({
  type: z.enum(SECTION_TYPES as [string, ...string[]]),
  title: z.string().max(255).nullish(),
  subtitle: z.string().max(500).nullish(),
  eyebrow: z.string().max(100).nullish(),
  ctaLabel: z.string().max(100).nullish(),
  ctaUrl: z.string().max(2000).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
})

export async function POST(request: NextRequest) {
  const denied = await guard(request)
  if (denied) return denied

  const parsed = parseBody(bodySchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const orderRow = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM homepage_sections`
  )

  const section = await queryOne(
    `INSERT INTO homepage_sections
       (type, title, subtitle, eyebrow, cta_label, cta_url, config, display_order, is_active, starts_at, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      d.type, d.title ?? null, d.subtitle ?? null, d.eyebrow ?? null,
      d.ctaLabel ?? null, d.ctaUrl ?? null, JSON.stringify(d.config ?? {}),
      orderRow?.next ?? 0, d.isActive ?? true, d.startsAt ?? null, d.endsAt ?? null,
    ]
  )

  revalidatePath('/')
  return NextResponse.json({ section })
}

// Bulk reorder. One atomic statement rather than N sequential updates, so an interrupted
// request cannot leave the page half-reordered.
export async function PATCH(request: NextRequest) {
  const denied = await guard(request)
  if (denied) return denied

  const body = await request.json().catch(() => ({}))
  const order: string[] = Array.isArray(body?.order) ? body.order : []
  if (order.length === 0) return NextResponse.json({ error: 'order[] required' }, { status: 400 })

  await withTransaction(async client => {
    await client.query(
      `UPDATE homepage_sections s SET display_order = v.ord - 1, updated_at = NOW()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, ord)
       WHERE s.id = v.id`,
      [order],
    )
  })

  revalidatePath('/')
  return NextResponse.json({ success: true })
}
