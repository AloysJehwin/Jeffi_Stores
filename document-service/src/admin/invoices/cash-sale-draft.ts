import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { parseBody } from '../../lib/validate'
import { canDiscard, closeLock, draftLockResponse, epochFrom, withDraftWrite } from '../../lib/draft-locks'
import { heldBillSchema } from './cash-sale-drafts'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'invoices:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const row = await queryOne(`SELECT * FROM cash_sale_drafts WHERE id = $1`, [id])
  if (!row) return NextResponse.json({ error: 'This bill was already completed or discarded' }, { status: 404 })
  return NextResponse.json({ draft: row })
}

const JSON_COLS = new Set(['items', 'assignments'])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = parseBody(heldBillSchema, await request.json(), `PATCH /api/admin/invoices/cash-sale/drafts/${id}`)
  if (!parsed.ok) return parsed.response

  const sets: string[] = []
  const vals: unknown[] = []
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue
    vals.push(JSON_COLS.has(key) ? JSON.stringify(value) : (value ?? null))
    sets.push(`${key} = $${vals.length}${JSON_COLS.has(key) ? '::jsonb' : ''}`)
  }
  if (!sets.length) return NextResponse.json({ ok: true })
  vals.push(id)
  try {
    const r = await withDraftWrite(
      admin,
      'cash_sale',
      id,
      client => client.query(`UPDATE cash_sale_drafts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals),
      { epoch: epochFrom(request) }
    )
    if (!r.rowCount) return NextResponse.json({ error: 'This bill was already completed or discarded' }, { status: 404 })
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
  if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  try {
    await withTransaction(async client => {
      const denied = await canDiscard(admin, 'cash_sale', id, client)
      if (denied) throw denied
      const r = await client.query(`DELETE FROM cash_sale_drafts WHERE id = $1`, [id])
      if (r.rowCount) await closeLock(client, admin, 'cash_sale', id, 'discarded')
    })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}
