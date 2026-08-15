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
    applied_at: string; rolled_back_at: string | null; is_rollback: boolean; value: any; snapshot: any
  }>(
    `SELECT id, operation, product_count, applied_by, applied_at, rolled_back_at, is_rollback, value, snapshot
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

  const raw = log.snapshot ?? null

  // Normalise both snapshot shapes:
  //  • legacy: bare array of { id, name, before } (products only)
  //  • current: { products, variants, subs, variantUnits }
  type Row = { id: string; name?: string; before: Record<string, unknown> }
  type UnitRow = { variant_id: string; product_id: string; before: Record<string, unknown> | null }
  type ImageSnap = { product_id: string; rows: Record<string, unknown>[] }
  let products: Row[] = []
  let variants: Row[] = []
  let subs: Row[] = []
  let variantUnits: UnitRow[] = []
  let productImages: ImageSnap[] = []
  if (Array.isArray(raw)) {
    products = raw as Row[]
  } else if (raw && typeof raw === 'object') {
    products = raw.products ?? []
    variants = raw.variants ?? []
    subs = raw.subs ?? []
    variantUnits = raw.variantUnits ?? []
    productImages = raw.productImages ?? []
  }

  if (!products.length && !variants.length && !subs.length && !variantUnits.length && !productImages.length) {
    return NextResponse.json({ error: 'No snapshot data — cannot rollback this operation' }, { status: 409 })
  }

  const operation: string = log.operation

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

  // Restore a set of rows on `table` by writing back every captured `before` field.
  async function restoreRows(client: any, table: string, rows: Row[]) {
    for (const row of rows) {
      const b = row.before as Record<string, unknown>
      const fields = Object.keys(b)
      if (!fields.length) continue
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
      await client.query(
        `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = $1`,
        [row.id, ...fields.map(f => b[f])]
      )
      restored++
    }
  }

  try {
    await withTransaction(async (client) => {
      if (['inflate_price', 'set_discount', 'set_mrp_ex_gst'].includes(operation)) {
        await restoreRows(client, 'products', products)
        await restoreRows(client, 'product_variants', variants)
        await restoreRows(client, 'product_sub_variants', subs)
      } else if (SIMPLE_FIELD_MAP[operation]) {
        await restoreRows(client, 'products', products)
      } else if (operation === 'set_selling_unit') {
        // Product-level base unit
        for (const row of products) {
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
        // Variant base unit rows + product_variants.unit
        for (const vu of variantUnits) {
          const b = vu.before
          // Restore the simple varchar on the variant row
          const variantUnit = (b as any)?.variant_unit ?? null
          await client.query(
            `UPDATE product_variants SET unit = $1, updated_at = NOW() WHERE id = $2`,
            [variantUnit, vu.variant_id]
          )
          if (!b || (b as any).unit == null) {
            // There was no base unit row before — remove any the operation created
            await client.query(
              `DELETE FROM product_units WHERE variant_id = $1 AND is_base = true`,
              [vu.variant_id]
            )
          } else {
            const ub = b as any
            await client.query(
              `INSERT INTO product_units (product_id, variant_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false)
               ON CONFLICT (variant_id, unit) WHERE variant_id IS NOT NULL
               DO UPDATE SET factor=$4, dimension=$5, display_label=$6, min_qty=$7, max_qty=$8, qty_step=$9, is_base=true, updated_at=NOW()`,
              [vu.product_id, vu.variant_id, ub.unit, ub.factor, ub.dimension, ub.display_label, ub.min_qty, ub.max_qty, ub.qty_step]
            )
          }
          restored++
        }
      } else if (operation === 'set_images') {
        // Slot-replace rollback: each snapshot entry holds the ONE row that was
        // replaced (at its display_order). Delete whatever now occupies that slot
        // for the product and re-insert the original row verbatim (its old S3 key
        // was never deleted, so it's still valid). Sibling images are untouched.
        for (const snap of productImages) {
          for (const r of snap.rows) {
            await client.query(
              `DELETE FROM product_images WHERE product_id = $1 AND display_order = $2`,
              [snap.product_id, r.display_order]
            )
            await client.query(
              `INSERT INTO product_images (
                 id, product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
                 file_name, file_size, mime_type, width, height, alt_text, display_order, is_primary
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
              [r.id, r.product_id, r.image_url, r.thumbnail_url, r.s3_bucket, r.s3_key, r.s3_thumbnail_key,
               r.file_name, r.file_size, r.mime_type, r.width, r.height, r.alt_text, r.display_order, r.is_primary]
            )
          }
          restored++
        }
      } else {
        throw new Error(`Rollback not supported for operation: ${operation}`)
      }

      await client.query(
        `UPDATE controls_operation_log SET rolled_back_at = NOW(), rolled_back_by = $2 WHERE id = $1`,
        [log_id, admin.email ?? null]
      )

      const affectedIds = products.length ? products.map(r => r.id) : productImages.map(s => s.product_id)
      await client.query(
        `INSERT INTO controls_operation_log (operation, product_ids, value, snapshot, applied_by, admin_id, product_count, is_rollback)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [operation, affectedIds, null, JSON.stringify(raw), admin.email ?? null, admin.adminId ?? null, affectedIds.length]
      )
    })

    return NextResponse.json({ success: true, restored })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Rollback failed' }, { status: 500 })
  }
}
