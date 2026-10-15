import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { UpdateSchema } from '../_lib/schema'

export const dynamic = 'force-dynamic'

async function gate(req: NextRequest, id: string) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!zUuid.safeParse(id).success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  return null
}

const COLUMNS = {
  key: 'key',
  label: 'label',
  description: 'description',
  value: 'value',
  isEnabled: 'is_enabled',
} as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await gate(req, id)
  if (denied) return denied

  const raw = await req.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = parseBody(UpdateSchema, raw)
  if (!parsed.ok) return parsed.response

  const sets: string[] = []
  const values: unknown[] = []
  for (const [field, column] of Object.entries(COLUMNS)) {
    const v = parsed.data[field as keyof typeof COLUMNS]
    if (v === undefined) continue
    values.push(v)
    sets.push(`${column} = $${values.length}`)
  }
  values.push(id)

  try {
    const row = await queryOne<{ id: string }>(
      `UPDATE template_variables SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING id`,
      values
    )
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    if (e?.code === '23505')
      return NextResponse.json({ error: 'A variable with this key already exists' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await gate(req, id)
  if (denied) return denied
  const row = await queryOne<{ id: string }>(`DELETE FROM template_variables WHERE id = $1 RETURNING id`, [id])
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
