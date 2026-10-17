import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Platform AI price list (control plane ai_price_list). Platform admin only; writes need ecom_billing:write.
const CAPABILITIES = ['text', 'embed', 'vision', 'image', 'video'] as const
const UNIT_TYPES = ['token_1k_in', 'token_1k_out', 'image', 'video_second', 'call'] as const
const COLS = 'id, capability, provider, model, unit_type, cost_inr::float8 AS cost_inr, price_inr::float8 AS price_inr, active, updated_at'

function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 10000) / 10000 : null
}
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)

export async function GET(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:read'))
  if (admin instanceof NextResponse) return admin
  try {
    const r = await controlPlanePool().query(`SELECT ${COLS} FROM ai_price_list ORDER BY capability, provider, model, unit_type`)
    return NextResponse.json({ rows: r.rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  const capability = CAPABILITIES.find(c => c === b.capability)
  const unitType = UNIT_TYPES.find(u => u === b.unit_type)
  const provider = text(b.provider, 32)
  const model = text(b.model ?? '*', 128)
  const cost = money(b.cost_inr ?? 0)
  const price = money(b.price_inr ?? 0)
  if (!capability || !unitType || !provider || !model || cost == null || price == null)
    return NextResponse.json({ error: 'capability, provider, model, unit_type and non-negative cost/price are required' }, { status: 400 })
  try {
    const r = await controlPlanePool().query(
      `INSERT INTO ai_price_list (capability, provider, model, unit_type, cost_inr, price_inr, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (capability, provider, model, unit_type) DO NOTHING
       RETURNING ${COLS}`,
      [capability, provider.toLowerCase(), model, unitType, cost, price, b.active !== false]
    )
    if (!r.rowCount) return NextResponse.json({ error: 'A row for that capability, provider, model and unit already exists' }, { status: 409 })
    return NextResponse.json({ row: r.rows[0] }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const b = await req.json().catch(() => ({}))
  if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const sets: string[] = []
  const vals: unknown[] = [b.id]
  for (const k of ['cost_inr', 'price_inr'] as const) {
    if (b[k] === undefined) continue
    const v = money(b[k])
    if (v == null) return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 })
    vals.push(v)
    sets.push(`${k} = $${vals.length}`)
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return NextResponse.json({ error: 'active must be true or false' }, { status: 400 })
    vals.push(b.active)
    sets.push(`active = $${vals.length}`)
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  try {
    const r = await controlPlanePool().query(
      `UPDATE ai_price_list SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      vals
    )
    if (!r.rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ row: r.rows[0] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
