import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

async function getDraft(productId: string) {
  return queryOne<{ product_id: string; units: Record<string, unknown>[] }>(
    `SELECT product_id, units FROM product_drafts WHERE product_id = $1`,
    [productId]
  )
}

// GET — return units from draft.units JSONB (same shape as live units route)
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await getDraft(id)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  const units = Array.isArray(draft.units) ? draft.units : []
  const base = units.find((u: any) => u.is_base) ?? null
  return NextResponse.json({ units, inherited: false, rules: base ? [{ unit: (base as any).unit, dimension: (base as any).dimension }] : [] })
}

// POST — add or update a unit in draft.units JSONB
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await getDraft(id)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const body = await req.json()
  const units: any[] = Array.isArray(draft.units) ? [...draft.units] : []
  const newUnit = { ...body, id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}` }

  if (body.is_base) {
    // Replace existing base unit
    const idx = units.findIndex((u: any) => u.is_base)
    if (idx >= 0) units[idx] = newUnit
    else units.unshift(newUnit)
  } else {
    units.push(newUnit)
  }

  await query(
    `UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(units)]
  )
  return NextResponse.json({ success: true, unit: newUnit })
}

// DELETE — remove a unit from draft.units by id
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const draft = await getDraft(id)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const { unitId } = await req.json()
  const units = (Array.isArray(draft.units) ? draft.units : []).filter((u: any) => u.id !== unitId)

  await query(
    `UPDATE product_drafts SET units = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [id, JSON.stringify(units)]
  )
  return NextResponse.json({ success: true })
}
