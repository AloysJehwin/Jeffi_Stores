import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'

export const dynamic = 'force-dynamic'

// `type` is deliberately absent: changing a section's type orphans its config, so the admin
// deletes and re-adds instead.
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  subtitle: 'subtitle',
  eyebrow: 'eyebrow',
  ctaLabel: 'cta_label',
  ctaUrl: 'cta_url',
  config: 'config',
  isActive: 'is_active',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
}

const patchSchema = z.object({
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

async function guard(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request)
  if (denied) return denied
  const { id } = await params

  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response

  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (!(key in parsed.data)) continue
    const raw = (parsed.data as Record<string, unknown>)[key]
    sets.push(`${column} = $${values.length + 1}`)
    values.push(column === 'config' ? JSON.stringify(raw ?? {}) : raw ?? null)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  values.push(id)
  const section = await queryOne(
    `UPDATE homepage_sections SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length} RETURNING *`,
    values,
  )
  if (!section) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  revalidatePath('/')
  return NextResponse.json({ section })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request)
  if (denied) return denied
  const { id } = await params

  await query(`DELETE FROM homepage_sections WHERE id = $1`, [id])
  revalidatePath('/')
  return NextResponse.json({ success: true })
}
