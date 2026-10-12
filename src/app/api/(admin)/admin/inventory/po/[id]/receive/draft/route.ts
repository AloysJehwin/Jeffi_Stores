import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

/** Load the open receive-draft for this PO. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const row = await queryOne(
    `SELECT po_id, admin_id, line_items, serials, updated_at
       FROM po_receive_drafts WHERE po_id = $1`,
    [id]
  )
  return NextResponse.json({ draft: row })
}

const patchSchema = z
  .object({
    line_items: z.array(z.record(z.string(), z.unknown())).optional(),
    serials: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .partial()

/** Upsert the receive-draft. One open draft per PO. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  // Ensure the PO exists before we insert.
  const po = await queryOne<{ id: string }>(`SELECT id FROM purchase_orders WHERE id = $1`, [id])
  if (!po) return NextResponse.json({ error: 'PO not found' }, { status: 404 })

  await query(
    `INSERT INTO po_receive_drafts (po_id, admin_id, line_items, serials)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
     ON CONFLICT (po_id) DO UPDATE
       SET line_items = COALESCE(EXCLUDED.line_items, po_receive_drafts.line_items),
           serials = COALESCE(EXCLUDED.serials, po_receive_drafts.serials),
           admin_id = EXCLUDED.admin_id,
           updated_at = now()`,
    [
      id,
      admin.id,
      d.line_items !== undefined ? JSON.stringify(d.line_items) : null,
      d.serials !== undefined ? JSON.stringify(d.serials) : null,
    ]
  )
  return NextResponse.json({ ok: true })
}

/** Discard the receive-draft (also used after a successful Post Receipt). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await query(`DELETE FROM po_receive_drafts WHERE po_id = $1`, [id])
  return NextResponse.json({ ok: true })
}
