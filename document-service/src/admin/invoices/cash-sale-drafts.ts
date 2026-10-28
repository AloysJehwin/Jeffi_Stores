import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryMany, queryOne } from '@jeffi/tenancy'
import { z } from 'zod'
import { parseBody } from '../../lib/validate'
import { lockBadges } from '../../lib/draft-locks'

// Held cash-sale bills. The counter is shared: a held bill is parked unlocked so any cashier can
// resume it (the first save claims the lock). Lines are kept as typed (half-filled custom ones
// included); Complete Sale validates them.

export const heldBillSchema = z
  .object({
    label: z.string().trim().max(80).nullish(),
    payment_mode: z.enum(['cash', 'upi', 'upi_qr']),
    notes: z.string().max(2000).nullish(),
    items: z.array(z.record(z.string(), z.unknown())).max(200),
    assignments: z
      .object({
        batches: z.record(z.string(), z.array(z.object({ batch_id: z.string(), qty: z.coerce.number() }))),
        batch_labels: z.record(z.string(), z.string()),
        serials: z.array(z.object({ order_item_id: z.string(), serial_number: z.string() })),
      })
      .partial(),
    total_estimate: z.coerce.number().min(0),
  })
  .partial()

const MAX_HELD_PER_ADMIN = 50

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'invoices:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const rows = await queryMany<any>(
    `SELECT d.id, d.label, d.payment_mode, d.total_estimate, d.updated_at, d.admin_id,
            jsonb_array_length(d.items) AS line_count,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS admin_name
       FROM cash_sale_drafts d
       LEFT JOIN admins a ON a.id = d.admin_id
       LEFT JOIN users u ON u.id = a.user_id
      ORDER BY d.updated_at DESC`
  )
  const locks = await lockBadges(admin, 'cash_sale', rows.map(r => r.id))
  return NextResponse.json({ drafts: rows.map(r => ({ ...r, lock: locks[r.id] ?? null })) })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'invoices:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = parseBody(heldBillSchema, await request.json(), 'POST /api/admin/invoices/cash-sale/drafts')
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const held = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM cash_sale_drafts WHERE admin_id = $1`, [admin.id])
  if (Number(held?.n ?? 0) >= MAX_HELD_PER_ADMIN)
    return NextResponse.json({ error: `You already have ${MAX_HELD_PER_ADMIN} held bills — complete or discard some first` }, { status: 409 })

  const row = await queryOne<{ id: string }>(
    `INSERT INTO cash_sale_drafts (admin_id, label, payment_mode, notes, items, assignments, total_estimate)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING id`,
    [
      admin.id,
      d.label || null,
      d.payment_mode ?? 'cash',
      d.notes || null,
      JSON.stringify(d.items ?? []),
      JSON.stringify(d.assignments ?? {}),
      d.total_estimate ?? 0,
    ]
  )
  return NextResponse.json({ id: row!.id }, { status: 201 })
}
