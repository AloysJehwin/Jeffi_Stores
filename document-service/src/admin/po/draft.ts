import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { z } from 'zod'
import { parseBody } from '../../lib/validate'
import { canDiscard, closeLock, draftLockResponse, epochFrom, withDraftWrite } from '../../lib/draft-locks'


// Any inventory writer can open a draft; only its lock holder writes it (others read-only).
async function openDraft(id: string) {
  const row = await queryOne<{ id: string }>(`SELECT id FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`, [id])
  return !!row
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const row = await queryOne(`SELECT * FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`, [id])
  if (!row) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  return NextResponse.json({ draft: row })
}

const patchSchema = z
  .object({
    supplier_id: z.guid().nullish(),
    order_date: z.string().nullish(),
    expected_date: z.string().nullish(),
    status: z.string().max(32).nullish(),
    notes: z.string().nullish(),
    line_items: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .partial()

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!(await openDraft(id))) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const [key, dbKey] of [
    ['supplier_id', 'supplier_id'],
    ['order_date', 'order_date'],
    ['expected_date', 'expected_date'],
    ['status', 'status'],
    ['notes', 'notes'],
  ] as const) {
    if (key in d) {
      sets.push(`${dbKey} = $${i++}`)
      vals.push((d as Record<string, unknown>)[key] ?? null)
    }
  }
  if ('line_items' in d) {
    sets.push(`line_items = $${i++}::jsonb`)
    vals.push(JSON.stringify(d.line_items ?? []))
  }
  if (sets.length === 0) return NextResponse.json({ ok: true })
  vals.push(id)
  try {
    await withDraftWrite(
      admin,
      'po_new',
      id,
      client => client.query(`UPDATE po_drafts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i} AND promoted_po_id IS NULL`, vals),
      { epoch: epochFrom(request) }
    )
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    await withTransaction(async client => {
      const denied = await canDiscard(admin, 'po_new', id, client)
      if (denied) throw denied
      const r = await client.query(`DELETE FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`, [id])
      // Nothing deleted (already turned into a PO): leave its lock's tombstone alone.
      if (r.rowCount) await closeLock(client, admin, 'po_new', id, 'discarded')
    })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}
