import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { query, queryMany, queryOne } from '@jeffi/tenancy'
import { z } from 'zod'
import { parseBody } from '../../lib/validate'
import { acquireLock, isDraftLockError, lockNewDraft } from '../../lib/draft-locks'


/** List my open PO drafts (promoted_po_id IS NULL): ones I hold, or started and nobody holds. */
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const rows = await queryMany(
    `SELECT d.id, d.supplier_id, s.name AS supplier_name, d.order_date, d.expected_date,
            d.status, d.notes, jsonb_array_length(d.line_items) AS line_count, d.updated_at
       FROM po_drafts d
       LEFT JOIN suppliers s ON s.id = d.supplier_id
       LEFT JOIN draft_locks l ON l.resource_type = 'po_new' AND l.resource_id = d.id AND l.closed_at IS NULL
      WHERE d.promoted_po_id IS NULL
        AND (l.owner_admin_id = $1 OR (d.admin_id = $1 AND l.owner_admin_id IS NULL))
      ORDER BY d.updated_at DESC`,
    [admin.id]
  )
  return NextResponse.json({ drafts: rows })
}

const createSchema = z
  .object({
    supplier_id: z.guid().nullish(),
    order_date: z.string().nullish(),
    expected_date: z.string().nullish(),
    status: z.string().max(32).nullish(),
    notes: z.string().nullish(),
    line_items: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .partial()

/** Create a new open PO draft for the current admin. */
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Partial unique index enforces one open draft per admin — reuse if one is already open.
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM po_drafts WHERE admin_id = $1 AND promoted_po_id IS NULL LIMIT 1`,
    [admin.id]
  )
  if (existing) {
    // Handed over or taken over: still this admin's one open draft, opened read-only (423).
    try {
      await acquireLock(null, admin, 'po_new', existing.id)
    } catch (err) {
      if (!isDraftLockError(err)) throw err
      return NextResponse.json({ ...err.body(), id: existing.id, resumed: true }, { status: 423 })
    }
    return NextResponse.json({ id: existing.id, resumed: true })
  }

  const parsed = parseBody(createSchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const row = await queryOne<{ id: string }>(
    `INSERT INTO po_drafts (admin_id, supplier_id, order_date, expected_date, status, notes, line_items)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      admin.id,
      d.supplier_id ?? null,
      d.order_date ?? null,
      d.expected_date ?? null,
      d.status ?? null,
      d.notes ?? null,
      JSON.stringify(d.line_items ?? []),
    ]
  )
  if (row?.id) await lockNewDraft(admin, 'po_new', row.id)
  return NextResponse.json({ id: row?.id, resumed: false })
}
