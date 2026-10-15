import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'
import { listCustomTemplateVariables, listTemplateVariables } from '@/lib/templates/variables'
import { CreateSchema } from './_lib/schema'

export const dynamic = 'force-dynamic'

// Every composer reads this, so any authenticated admin may list; edits are Site Controls (settings:write).
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [variables, custom] = await Promise.all([
    listTemplateVariables(),
    listCustomTemplateVariables().catch(() => []),
  ])
  return NextResponse.json({ variables, custom })
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const raw = await req.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = parseBody(CreateSchema, raw)
  if (!parsed.ok) return parsed.response
  const { key, label, description, value, isEnabled } = parsed.data

  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO template_variables (key, label, description, value, is_enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [key, label, description, value, isEnabled]
    )
    return NextResponse.json({ id: row?.id }, { status: 201 })
  } catch (e: any) {
    if (e?.code === '23505')
      return NextResponse.json({ error: 'A variable with this key already exists' }, { status: 409 })
    throw e
  }
}
