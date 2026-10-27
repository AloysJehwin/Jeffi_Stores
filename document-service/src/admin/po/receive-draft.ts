import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { z } from 'zod'
import { parseBody } from '../../lib/validate'
import { acquireLock, announceLock, assertHolder, canDiscard, closeLock, draftLockResponse, epochFrom } from '../../lib/draft-locks'


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

/** Upsert the receive-draft. One open draft per PO, written only by its lock holder. */
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

  // admin_id stays the admin who started the receipt; the lock says who holds it now.
  try {
    const lock = await withTransaction(async client => {
      const r = await client.query<{ inserted: boolean }>(
        `INSERT INTO po_receive_drafts (po_id, admin_id, line_items, serials)
           VALUES ($1, $2, COALESCE($3::jsonb, '[]'::jsonb), COALESCE($4::jsonb, '[]'::jsonb))
         ON CONFLICT (po_id) DO UPDATE
           SET line_items = COALESCE(EXCLUDED.line_items, po_receive_drafts.line_items),
               serials = COALESCE(EXCLUDED.serials, po_receive_drafts.serials),
               updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          id,
          admin.adminId,
          d.line_items !== undefined ? JSON.stringify(d.line_items) : null,
          d.serials !== undefined ? JSON.stringify(d.serials) : null,
        ]
      )
      return r.rows[0]?.inserted
        ? acquireLock(client, admin, 'po_receive', id)
        : assertHolder(client, admin, 'po_receive', id, { epoch: epochFrom(request) })
    })
    await announceLock(admin, 'po_receive', id, lock)
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}

/** Discard the receive-draft (Post Receipt already removes it, so a later call is a no-op). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    await withTransaction(async client => {
      const denied = await canDiscard(admin, 'po_receive', id, client)
      if (denied) throw denied
      const r = await client.query(`DELETE FROM po_receive_drafts WHERE po_id = $1`, [id])
      if (r.rowCount) await closeLock(client, admin, 'po_receive', id, 'discarded')
    })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}
