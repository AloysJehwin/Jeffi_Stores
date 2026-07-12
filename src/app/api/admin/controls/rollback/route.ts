import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const logs = await queryMany<{
    id: string; operation: string; product_count: number; applied_by: string | null
    applied_at: string; rolled_back_at: string | null; is_rollback: boolean; value: any
  }>(
    `SELECT id, operation, product_count, applied_by, applied_at, rolled_back_at, is_rollback, value
     FROM controls_operation_log
     WHERE is_rollback = false
     ORDER BY applied_at DESC
     LIMIT 50`,
    []
  )

  return NextResponse.json({ logs: logs ?? [] })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { log_id } = await request.json()
  if (!log_id) return NextResponse.json({ error: 'log_id required' }, { status: 400 })

  const logRes = await query<{
    id: string; operation: string; snapshot: any; rolled_back_at: string | null; is_rollback: boolean
  }>(
    `SELECT id, operation, snapshot, rolled_back_at, is_rollback FROM controls_operation_log WHERE id = $1`,
    [log_id]
  )
  const log = logRes.rows[0]
  if (!log) return NextResponse.json({ error: 'Log entry not found' }, { status: 404 })
  if (log.rolled_back_at) return NextResponse.json({ error: 'This operation has already been rolled back' }, { status: 409 })
  if (log.is_rollback) return NextResponse.json({ error: 'Cannot roll back a rollback entry' }, { status: 409 })

  const snapshot: { id: string; name: string; before: Record<string, unknown> }[] = log.snapshot ?? []
  if (!snapshot.length) return NextResponse.json({ error: 'No snapshot data — cannot rollback this operation' }, { status: 409 })

  const operation: string = log.operation

  const PRICE_FIELDS = ['mrp_ex_gst', 'mrp', 'price_ex_gst', 'base_price', 'discount_pct']
  const SIMPLE_FIELD_MAP: Record<string, string[]> = {
    set_tax_class:         ['tax_class'],
    set_condition:         ['condition'],
    set_shipping_class:    ['shipping_class'],
    set_handling_days:     ['handling_days'],
    set_warranty_months:   ['warranty_months'],
    set_target_gender:     ['target_gender'],
    set_grade:             ['grade'],
    set_hsn_code:          ['hsn_code'],
    set_country_of_origin: ['country_of_origin'],
    set_featured:          ['is_featured'],
    set_searchable:        ['is_searchable'],
    set_active:            ['is_active'],
  }

  let restored = 0

  try {
    await withTransaction(async (client) => {
      if (['inflate_price', 'set_discount', 'set_mrp_ex_gst'].includes(operation)) {
        for (const row of snapshot) {
          const b = row.before as any
          const fields = PRICE_FIELDS.filter(f => f in b)
          if (!fields.length) continue
          const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
          await client.query(
            `UPDATE products SET ${sets}, updated_at = NOW() WHERE id = $1`,
            [row.id, ...fields.map(f => b[f])]
          )
          restored++
        }
      } else if (SIMPLE_FIELD_MAP[operation]) {
        const fields = SIMPLE_FIELD_MAP[operation]
        for (const row of snapshot) {
          const b = row.before as any
          const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
          await client.query(
            `UPDATE products SET ${sets}, updated_at = NOW() WHERE id = $1`,
            [row.id, ...fields.map(f => b[f])]
          )
          restored++
        }
      } else if (operation === 'set_selling_unit') {
        for (const row of snapshot) {
          const b = row.before as any
          if (b.unit == null) {
            await client.query(
              `DELETE FROM product_units WHERE product_id = $1 AND is_base = true AND variant_id IS NULL`,
              [row.id]
            )
          } else {
            await client.query(
              `INSERT INTO product_units (product_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)
               ON CONFLICT (product_id) WHERE is_base = true AND variant_id IS NULL
               DO UPDATE SET unit=$2, factor=$3, dimension=$4, display_label=$5, min_qty=$6, max_qty=$7, qty_step=$8, updated_at=NOW()`,
              [row.id, b.unit, b.factor, b.dimension, b.display_label, b.min_qty, b.max_qty, b.qty_step]
            )
          }
          restored++
        }
      } else {
        throw new Error(`Rollback not supported for operation: ${operation}`)
      }

      await client.query(
        `UPDATE controls_operation_log SET rolled_back_at = NOW(), rolled_back_by = $2 WHERE id = $1`,
        [log_id, admin.username ?? null]
      )

      await client.query(
        `INSERT INTO controls_operation_log (operation, product_ids, value, snapshot, applied_by, admin_id, product_count, is_rollback)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [operation, snapshot.map(r => r.id), null, JSON.stringify(snapshot), admin.username ?? null, admin.adminId ?? null, snapshot.length]
      )
    })

    return NextResponse.json({ success: true, restored })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Rollback failed' }, { status: 500 })
  }
}
