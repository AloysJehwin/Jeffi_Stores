import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

// GET — return draft fields
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const draft = await queryOne<{ supplier_id: string; fields: Record<string, unknown> }>(
    `SELECT supplier_id, fields FROM supplier_drafts WHERE supplier_id = $1`,
    [id]
  )
  return NextResponse.json({ draft_fields: draft?.fields ?? null })
}

// PATCH — save to draft
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await req.json()
  await query(
    `INSERT INTO supplier_drafts (supplier_id, fields, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (supplier_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
    [id, JSON.stringify(body)]
  )
  return NextResponse.json({ success: true })
}

// POST — publish draft to live
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const draft = await queryOne<{ supplier_id: string; fields: Record<string, unknown> }>(
    `SELECT supplier_id, fields FROM supplier_drafts WHERE supplier_id = $1`,
    [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })
  const f = draft.fields as any
  await query(
    `UPDATE suppliers SET
       name=$1, gstin=$2, contact_name=$3, phone=$4, email=$5, address=$6,
       payment_terms=$7, notes=$8, bank_name=$9, account_number=$10, ifsc=$11, upi_id=$12,
       updated_at=NOW()
     WHERE id=$13`,
    [
      f.name,
      f.gstin || null,
      f.contact_name || null,
      f.phone || null,
      f.email || null,
      f.address || null,
      f.payment_terms ? parseInt(f.payment_terms) : null,
      f.notes || null,
      f.bank_name || null,
      f.account_number || null,
      f.ifsc || null,
      f.upi_id || null,
      id,
    ]
  )
  await query(`DELETE FROM supplier_drafts WHERE supplier_id = $1`, [id])
  return NextResponse.json({ success: true })
}

// DELETE — discard draft
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  await query(`DELETE FROM supplier_drafts WHERE supplier_id = $1`, [id])
  return NextResponse.json({ success: true })
}
