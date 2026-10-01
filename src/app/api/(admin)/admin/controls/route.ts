import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne, query, withTransaction } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadProductImage, copyGalleryImageToProduct } from '@/lib/shared/s3'
import { buildAttributeFilterClauses } from '@/lib/catalog/product-attribute-filters'
import { buildProductSearchClause } from '@/lib/catalog/search'

type SnapshotRow = {
  id: string
  name: string
  before: Record<string, unknown>
}

// Full operation snapshot. Older logs stored a bare SnapshotRow[]; new logs store
// this object so rollback can restore child rows (variants / sub-variants / units)
// that an operation also mutated. Rollback reads both shapes.
type OperationSnapshot = {
  products: SnapshotRow[]
  variants: SnapshotRow[]
  subs: SnapshotRow[]
  variantUnits: { variant_id: string; product_id: string; before: Record<string, unknown> | null }[]
  // set_images: full product_images rows per product, so rollback can restore them.
  // The old S3 objects are never deleted on apply, so these rows remain valid.
  productImages?: { product_id: string; rows: Record<string, unknown>[] }[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function deriveFromMrpEx(mrpEx: number, discPct: number, gstPct: number) {
  const priceEx = round2(mrpEx * (1 - discPct / 100))
  const gstMult = 1 + gstPct / 100
  return {
    mrp_ex_gst: mrpEx,
    mrp: round2(mrpEx * gstMult),
    price_ex_gst: priceEx,
    base_price: round2(priceEx * gstMult),
  }
}

function applyPct(val: number, pct: number) {
  return round2(val * (1 + pct / 100))
}

// ── filter query builder ──────────────────────────────────────────────────────

function buildFilterQuery(filters: Record<string, string>) {
  const conditions: string[] = ['p.is_draft = false']
  if (filters.is_active === 'false') conditions.push('p.is_active = false')
  else if (filters.is_active !== 'any') conditions.push('p.is_active = true')
  if (filters.stock === 'low') conditions.push(`p.stock_status = 'Low Stock'`)
  else if (filters.stock === 'out') conditions.push(`p.stock_status = 'Out of Stock'`)
  const params: unknown[] = []

  function add(clause: string, val: unknown) {
    params.push(val)
    conditions.push(clause.replace('?', `$${params.length}`))
  }

  if (filters.category_id) {
    params.push(filters.category_id)
    const n = params.length
    conditions.push(
      `p.category_id = ANY(SELECT id FROM categories WHERE id = $${n}::uuid UNION SELECT id FROM categories WHERE parent_category_id = $${n}::uuid)`
    )
  }
  if (filters.brand_id) add('p.brand_id = ?::uuid', filters.brand_id)
  const attr = buildAttributeFilterClauses(filters, params.length + 1)
  conditions.push(...attr.conditions)
  params.push(...attr.params)
  if (filters.search) {
    const sc = buildProductSearchClause(filters.search, 'p.name', 'p.sku', 'p.search_vector', params.length + 1)
    conditions.push(sc.clause)
    params.push(...sc.params)
  }
  if (filters.product_ids) {
    const ids = filters.product_ids.split(',').filter(Boolean)
    if (ids.length) {
      params.push(ids)
      conditions.push(`p.id = ANY($${params.length}::uuid[])`)
    }
  }

  const where = conditions.join(' AND ')
  const sql = `
    SELECT p.id, p.name, p.has_variants, p.sku,
           p.mrp_ex_gst, p.mrp, p.price_ex_gst, p.base_price,
           p.discount_pct, p.gst_percentage,
           p.grade, p.condition, p.target_gender, p.shipping_class,
           p.tax_class, p.hsn_code, p.handling_days, p.warranty_months,
           p.is_featured, p.is_searchable, p.is_active,
           b.name AS brand_name, c.name AS category_name,
           (SELECT MIN(pv.mrp_ex_gst) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true) AS variant_mrp_min,
           (SELECT MAX(pv.mrp_ex_gst) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true) AS variant_mrp_max
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where}
    ORDER BY p.name`

  return { sql, params }
}

// ── GET — list products matching filters ──────────────────────────────────────

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'controls:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { sql, params } = buildFilterQuery(sp)

  const products = await queryMany(sql, params)
  return NextResponse.json({ products: products || [] })
}

// ── POST — apply bulk operation ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'controls:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Bulk image change uploads files → multipart. Everything else is JSON.
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    return handleBulkImages(request, admin)
  }

  const body = await request.json()
  const { operation, value, product_ids, filters = {}, inherit_to_variants = true } = body

  if (!operation) return NextResponse.json({ error: 'operation required' }, { status: 400 })
  if (!product_ids?.length) return NextResponse.json({ error: 'product_ids required' }, { status: 400 })

  const ids: string[] = product_ids

  try {
    let updated = 0
    let logId: string | null = null

    await withTransaction(async client => {
      // ── capture snapshot (before values) ────────────────────────────────
      const snapshot: OperationSnapshot = { products: [], variants: [], subs: [], variantUnits: [] }

      const PRICE_FIELDS = ['mrp_ex_gst', 'mrp', 'price_ex_gst', 'base_price', 'discount_pct']
      // Variant price rows use `price` instead of `base_price`.
      const VARIANT_PRICE_FIELDS = ['mrp_ex_gst', 'mrp', 'price_ex_gst', 'price', 'discount_pct']
      const SIMPLE_FIELD_MAP: Record<string, string[]> = {
        set_tax_class: ['tax_class'],
        set_condition: ['condition'],
        set_shipping_class: ['shipping_class'],
        set_handling_days: ['handling_days'],
        set_warranty_months: ['warranty_months'],
        set_target_gender: ['target_gender'],
        set_grade: ['grade'],
        set_hsn_code: ['hsn_code'],
        set_country_of_origin: ['country_of_origin'],
        set_featured: ['is_featured'],
        set_searchable: ['is_searchable'],
        set_active: ['is_active'],
      }

      if (['inflate_price', 'set_discount', 'set_mrp_ex_gst'].includes(operation)) {
        const rows = await client.query(
          `SELECT id, name, ${PRICE_FIELDS.join(', ')} FROM products WHERE id = ANY($1::uuid[])`,
          [ids]
        )
        for (const r of rows.rows) {
          snapshot.products.push({
            id: r.id,
            name: r.name,
            before: Object.fromEntries(PRICE_FIELDS.map(f => [f, r[f]])),
          })
        }
        // inflate_price and set_discount also mutate variants (and inflate also
        // mutates sub-variants), so snapshot those too. set_mrp_ex_gst is
        // product-only, so skip child capture for it.
        if (operation === 'inflate_price' || operation === 'set_discount') {
          const vrows = await client.query(
            `SELECT pv.id, ${VARIANT_PRICE_FIELDS.map(f => `pv.${f}`).join(', ')}
             FROM product_variants pv WHERE pv.product_id = ANY($1::uuid[]) AND pv.is_active = true`,
            [ids]
          )
          for (const r of vrows.rows) {
            snapshot.variants.push({
              id: r.id,
              name: '',
              before: Object.fromEntries(VARIANT_PRICE_FIELDS.map(f => [f, r[f]])),
            })
          }
        }
        if (operation === 'inflate_price' || operation === 'set_discount') {
          const srows = await client.query(
            `SELECT psv.id, ${VARIANT_PRICE_FIELDS.map(f => `psv.${f}`).join(', ')}
             FROM product_sub_variants psv
             JOIN product_variants pv ON pv.id = psv.variant_id
             WHERE pv.product_id = ANY($1::uuid[]) AND pv.is_active = true AND psv.is_active = true`,
            [ids]
          )
          for (const r of srows.rows) {
            snapshot.subs.push({
              id: r.id,
              name: '',
              before: Object.fromEntries(VARIANT_PRICE_FIELDS.map(f => [f, r[f]])),
            })
          }
        }
      } else if (SIMPLE_FIELD_MAP[operation]) {
        const fields = SIMPLE_FIELD_MAP[operation]
        const rows = await client.query(
          `SELECT id, name, ${fields.join(', ')} FROM products WHERE id = ANY($1::uuid[])`,
          [ids]
        )
        for (const r of rows.rows) {
          snapshot.products.push({ id: r.id, name: r.name, before: Object.fromEntries(fields.map(f => [f, r[f]])) })
        }
      } else if (operation === 'set_selling_unit') {
        const rows = await client.query(
          `SELECT p.id, p.name,
                  pu.unit, pu.factor, pu.dimension, pu.display_label, pu.min_qty, pu.max_qty, pu.qty_step
           FROM products p
           LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base = true AND pu.variant_id IS NULL
           WHERE p.id = ANY($1::uuid[])`,
          [ids]
        )
        for (const r of rows.rows) {
          snapshot.products.push({
            id: r.id,
            name: r.name,
            before: {
              unit: r.unit,
              factor: r.factor,
              dimension: r.dimension,
              display_label: r.display_label,
              min_qty: r.min_qty,
              max_qty: r.max_qty,
              qty_step: r.qty_step,
            },
          })
        }
        // When inheriting to variants we also change each variant's base unit row
        // and product_variants.unit — snapshot both so rollback can restore them.
        if (inherit_to_variants) {
          const vrows = await client.query(
            `SELECT pv.id AS variant_id, pv.product_id, pv.unit AS variant_unit,
                    pu.unit, pu.factor, pu.dimension, pu.display_label, pu.min_qty, pu.max_qty, pu.qty_step
             FROM product_variants pv
             LEFT JOIN product_units pu ON pu.variant_id = pv.id AND pu.is_base = true
             WHERE pv.product_id = ANY($1::uuid[]) AND pv.is_active = true`,
            [ids]
          )
          for (const r of vrows.rows) {
            snapshot.variantUnits.push({
              variant_id: r.variant_id,
              product_id: r.product_id,
              before:
                r.unit == null
                  ? { variant_unit: r.variant_unit }
                  : {
                      unit: r.unit,
                      factor: r.factor,
                      dimension: r.dimension,
                      display_label: r.display_label,
                      min_qty: r.min_qty,
                      max_qty: r.max_qty,
                      qty_step: r.qty_step,
                      variant_unit: r.variant_unit,
                    },
            })
          }
        }
      }

      // ── price inflation ───────────────────────────────────────────────────
      if (operation === 'inflate_price') {
        const pct = parseFloat(value)
        if (!pct || pct <= 0) throw new Error('percentage must be > 0')

        const products = await client.query(
          `SELECT p.id, p.mrp_ex_gst, p.discount_pct, p.gst_percentage, p.has_variants
           FROM products p WHERE p.id = ANY($1::uuid[])`,
          [ids]
        )

        for (const p of products.rows) {
          const curMrpEx = parseFloat(p.mrp_ex_gst)
          if (!isNaN(curMrpEx) && curMrpEx > 0) {
            const d = deriveFromMrpEx(
              applyPct(curMrpEx, pct),
              parseFloat(p.discount_pct) || 0,
              parseFloat(p.gst_percentage) || 0
            )
            await client.query(
              `UPDATE products SET mrp_ex_gst=$1, mrp=$2, price_ex_gst=$3, base_price=$4, updated_at=NOW() WHERE id=$5`,
              [d.mrp_ex_gst, d.mrp, d.price_ex_gst, d.base_price, p.id]
            )
            updated++
          }
        }

        const variants = await client.query(
          `SELECT pv.id, pv.mrp_ex_gst, p.discount_pct, p.gst_percentage
           FROM product_variants pv JOIN products p ON p.id=pv.product_id
           WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true`,
          [ids]
        )
        for (const v of variants.rows) {
          const cur = parseFloat(v.mrp_ex_gst)
          if (!isNaN(cur) && cur > 0) {
            const d = deriveFromMrpEx(
              applyPct(cur, pct),
              parseFloat(v.discount_pct) || 0,
              parseFloat(v.gst_percentage) || 0
            )
            await client.query(
              `UPDATE product_variants SET mrp_ex_gst=$1, mrp=$2, price_ex_gst=$3, price=$4, updated_at=NOW() WHERE id=$5`,
              [d.mrp_ex_gst, d.mrp, d.price_ex_gst, d.base_price, v.id]
            )
          }
        }

        const subs = await client.query(
          `SELECT psv.id, psv.mrp_ex_gst, p.discount_pct, p.gst_percentage
           FROM product_sub_variants psv
           JOIN product_variants pv ON pv.id=psv.variant_id
           JOIN products p ON p.id=pv.product_id
           WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true AND psv.is_active=true`,
          [ids]
        )
        for (const sv of subs.rows) {
          const cur = parseFloat(sv.mrp_ex_gst)
          if (!isNaN(cur) && cur > 0) {
            const d = deriveFromMrpEx(
              applyPct(cur, pct),
              parseFloat(sv.discount_pct) || 0,
              parseFloat(sv.gst_percentage) || 0
            )
            await client.query(
              `UPDATE product_sub_variants SET mrp_ex_gst=$1, mrp=$2, price_ex_gst=$3, price=$4, updated_at=NOW() WHERE id=$5`,
              [d.mrp_ex_gst, d.mrp, d.price_ex_gst, d.base_price, sv.id]
            )
          }
        }
      }

      // ── set discount % ────────────────────────────────────────────────────
      else if (operation === 'set_discount') {
        const disc = parseFloat(value)
        if (isNaN(disc) || disc < 0 || disc > 100) throw new Error('discount must be 0–100')

        const products = await client.query(
          `SELECT id, mrp_ex_gst, gst_percentage FROM products WHERE id=ANY($1::uuid[])`,
          [ids]
        )
        for (const p of products.rows) {
          const mrpEx = parseFloat(p.mrp_ex_gst)
          if (!isNaN(mrpEx) && mrpEx > 0) {
            const d = deriveFromMrpEx(mrpEx, disc, parseFloat(p.gst_percentage) || 0)
            await client.query(
              `UPDATE products SET discount_pct=$1, mrp=$2, price_ex_gst=$3, base_price=$4, updated_at=NOW() WHERE id=$5`,
              [disc, d.mrp, d.price_ex_gst, d.base_price, p.id]
            )
            updated++
          }
        }

        const variants = await client.query(
          `SELECT pv.id, pv.mrp_ex_gst, p.gst_percentage
           FROM product_variants pv JOIN products p ON p.id=pv.product_id
           WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true`,
          [ids]
        )
        for (const v of variants.rows) {
          const cur = parseFloat(v.mrp_ex_gst)
          if (!isNaN(cur) && cur > 0) {
            const d = deriveFromMrpEx(cur, disc, parseFloat(v.gst_percentage) || 0)
            await client.query(
              `UPDATE product_variants SET discount_pct=$1, mrp=$2, price_ex_gst=$3, price=$4, updated_at=NOW() WHERE id=$5`,
              [disc, d.mrp, d.price_ex_gst, d.base_price, v.id]
            )
          }
        }

        // Sub-variants carry their own price and must be discounted too, otherwise a
        // product's cheapest sub-variant keeps its old (undiscounted) price.
        const subs = await client.query(
          `SELECT psv.id, psv.mrp_ex_gst, p.gst_percentage
           FROM product_sub_variants psv
           JOIN product_variants pv ON pv.id=psv.variant_id
           JOIN products p ON p.id=pv.product_id
           WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true AND psv.is_active=true`,
          [ids]
        )
        for (const sv of subs.rows) {
          const cur = parseFloat(sv.mrp_ex_gst)
          if (!isNaN(cur) && cur > 0) {
            const d = deriveFromMrpEx(cur, disc, parseFloat(sv.gst_percentage) || 0)
            await client.query(
              `UPDATE product_sub_variants SET discount_pct=$1, mrp=$2, price_ex_gst=$3, price=$4, updated_at=NOW() WHERE id=$5`,
              [disc, d.mrp, d.price_ex_gst, d.base_price, sv.id]
            )
          }
        }
      }

      // ── set MRP ex-GST directly ───────────────────────────────────────────
      else if (operation === 'set_mrp_ex_gst') {
        const mrpEx = parseFloat(value)
        if (isNaN(mrpEx) || mrpEx <= 0) throw new Error('MRP must be > 0')

        const products = await client.query(
          `SELECT id, discount_pct, gst_percentage FROM products WHERE id=ANY($1::uuid[])`,
          [ids]
        )
        for (const p of products.rows) {
          const d = deriveFromMrpEx(mrpEx, parseFloat(p.discount_pct) || 0, parseFloat(p.gst_percentage) || 0)
          await client.query(
            `UPDATE products SET mrp_ex_gst=$1, mrp=$2, price_ex_gst=$3, base_price=$4, updated_at=NOW() WHERE id=$5`,
            [d.mrp_ex_gst, d.mrp, d.price_ex_gst, d.base_price, p.id]
          )
          updated++
        }
      }

      // ── simple field sets ─────────────────────────────────────────────────
      else if (operation === 'set_tax_class') {
        await client.query(`UPDATE products SET tax_class=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      } else if (operation === 'set_condition') {
        await client.query(`UPDATE products SET condition=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      } else if (operation === 'set_shipping_class') {
        await client.query(`UPDATE products SET shipping_class=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_handling_days') {
        const days = parseInt(value)
        if (isNaN(days) || days < 0) throw new Error('handling_days must be >= 0')
        await client.query(`UPDATE products SET handling_days=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          days,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_warranty_months') {
        const months = parseInt(value)
        if (isNaN(months) || months < 0) throw new Error('warranty_months must be >= 0')
        await client.query(`UPDATE products SET warranty_months=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          months,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_target_gender') {
        await client.query(`UPDATE products SET target_gender=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_grade') {
        await client.query(`UPDATE products SET grade=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value || null,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_hsn_code') {
        await client.query(`UPDATE products SET hsn_code=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      } else if (operation === 'set_country_of_origin') {
        await client.query(`UPDATE products SET country_of_origin=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value,
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_featured') {
        await client.query(`UPDATE products SET is_featured=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value === 'true',
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_searchable') {
        await client.query(`UPDATE products SET is_searchable=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value === 'true',
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_active') {
        await client.query(`UPDATE products SET is_active=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [
          value === 'true',
          ids,
        ])
        updated = ids.length
      } else if (operation === 'set_selling_unit') {
        if (!value || typeof value !== 'object') throw new Error('unit config required')
        const { unit, factor, dimension = 'count', display_label, min_qty, max_qty, qty_step } = value as any
        if (!unit) throw new Error('unit name required')
        const f = parseFloat(factor)
        if (!Number.isFinite(f) || f <= 0) throw new Error('factor must be > 0')
        const minQ = parseFloat(min_qty) || 1
        const maxQ = max_qty != null && max_qty !== '' ? parseFloat(max_qty) : null
        const stepQ = parseFloat(qty_step) || 1

        // Upsert product-level base unit row for each product.
        // Target the one-base partial index so renaming the unit doesn't create a duplicate.
        for (const id of ids) {
          await client.query(
            `INSERT INTO product_units (product_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)
             ON CONFLICT (product_id) WHERE is_base = true AND variant_id IS NULL
             DO UPDATE SET unit=$2, factor=$3, dimension=$4, display_label=$5, min_qty=$6, max_qty=$7, qty_step=$8, updated_at=NOW()`,
            [id, unit, f, dimension, display_label ?? null, minQ, maxQ, stepQ]
          )
          updated++
        }

        if (inherit_to_variants) {
          // Upsert same unit row on every active variant of the selected products.
          const variants = await client.query(
            `SELECT pv.id, pv.product_id FROM product_variants pv WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true`,
            [ids]
          )
          for (const v of variants.rows) {
            // Demote any existing base row for this variant first, then upsert on (variant_id, unit)
            await client.query(
              `UPDATE product_units SET is_base = false WHERE variant_id = $1 AND is_base = true AND unit != $2`,
              [v.id, unit]
            )
            await client.query(
              `INSERT INTO product_units (product_id, variant_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false)
               ON CONFLICT (variant_id, unit) WHERE variant_id IS NOT NULL
               DO UPDATE SET factor=$4, dimension=$5, display_label=$6, min_qty=$7, max_qty=$8, qty_step=$9, is_base=true, updated_at=NOW()`,
              [v.product_id, v.id, unit, f, dimension, display_label ?? null, minQ, maxQ, stepQ]
            )
          }
          // Also update the simple unit varchar on variants
          await client.query(
            `UPDATE product_variants SET unit=$1, updated_at=NOW() WHERE product_id=ANY($2::uuid[]) AND is_active=true`,
            [unit, ids]
          )
        }
      } else {
        throw new Error(`Unknown operation: ${operation}`)
      }

      // ── insert operation log ─────────────────────────────────────────────
      const logRes = await client.query(
        `INSERT INTO controls_operation_log (operation, product_ids, value, snapshot, applied_by, admin_id, product_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          operation,
          ids,
          JSON.stringify(value ?? null),
          JSON.stringify(snapshot),
          admin.email ?? null,
          admin.adminId ?? null,
          ids.length,
        ]
      )
      logId = logRes.rows[0]?.id ?? null
    })

    return NextResponse.json({ success: true, updated, log_id: logId })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Operation failed' }, { status: 500 })
  }
}

// ── set_images — bulk replace ONE image slot by position (multipart) ──────────
// Replaces the image at slot N (1-based display_order) on every selected product
// with the uploaded image. Products that don't have that slot are SKIPPED. Slot 1
// carries the primary flag. Snapshots the replaced rows for rollback; old S3
// objects are never deleted, so rollback restores them (new objects orphan on undo).
const IMG_BUCKET = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'

async function handleBulkImages(request: NextRequest, admin: { email?: string | null; adminId?: string | null }) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const operation = String(form.get('operation') || '')
  if (operation !== 'set_images')
    return NextResponse.json({ error: 'Unsupported multipart operation' }, { status: 400 })

  let ids: string[] = []
  try {
    ids = JSON.parse(String(form.get('product_ids') || '[]'))
  } catch {
    ids = []
  }
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'product_ids required' }, { status: 400 })

  const altText = (form.get('alt_text') as string | null)?.trim() || null
  // Slot is 1-based in the UI; convert to 0-based display_order.
  const slot = parseInt(String(form.get('slot') || '1'), 10)
  if (!Number.isFinite(slot) || slot < 1) return NextResponse.json({ error: 'Invalid image slot' }, { status: 400 })
  const targetOrder = slot - 1

  // Source is EITHER an uploaded file OR a gallery image reference.
  const file = form.get('image_0')
  const galleryImageId = (form.get('gallery_image_id') as string | null)?.trim() || null
  const hasFile = file instanceof File && file.size > 0
  if (!hasFile && !galleryImageId)
    return NextResponse.json({ error: 'An image (upload or gallery) is required' }, { status: 400 })

  // The background worker outlives this request, so buffer the uploaded bytes now
  // (the FormData stream is gone once we respond) and rebuild a File per product.
  let fileBytes: ArrayBuffer | null = null
  let fileName = ''
  let fileType = ''
  if (hasFile) {
    fileBytes = await (file as File).arrayBuffer()
    fileName = (file as File).name
    fileType = (file as File).type
  }

  // If using a gallery image, resolve its S3 keys + metadata up front.
  let gallery: {
    s3_key: string
    s3_thumbnail_key: string
    image_url: string
    thumbnail_url: string
    file_name: string
    file_size: number | null
    mime_type: string | null
    width: number | null
    height: number | null
  } | null = null
  if (!hasFile && galleryImageId) {
    const g = await queryMany<any>(
      `SELECT s3_key, s3_thumbnail_key, image_url, thumbnail_url, file_name, file_size, mime_type, width, height
       FROM gallery_images WHERE id = $1`,
      [galleryImageId]
    )
    if (!g.length) return NextResponse.json({ error: 'Gallery image not found' }, { status: 404 })
    gallery = g[0]
  }

  // Slot read is synchronous so we can fast-fail (bad slot, nothing to do) before
  // enqueuing a job. The actual S3 work then runs in the background.
  const existing = await queryMany<{
    id: string
    product_id: string
    image_url: string
    thumbnail_url: string | null
    s3_bucket: string | null
    s3_key: string | null
    s3_thumbnail_key: string | null
    file_name: string
    file_size: number | null
    mime_type: string | null
    width: number | null
    height: number | null
    alt_text: string | null
    display_order: number
    is_primary: boolean
  }>(
    `SELECT id, product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
            file_name, file_size, mime_type, width, height, alt_text, display_order, is_primary
     FROM product_images
     WHERE product_id = ANY($1::uuid[]) AND display_order = $2`,
    [ids, targetOrder]
  )
  const slotRowByProduct = new Map(existing.map(r => [r.product_id, r]))
  const targetIds = ids.filter(pid => slotRowByProduct.has(pid))
  const skipped = ids.length - targetIds.length

  if (targetIds.length === 0) {
    return NextResponse.json({ error: `None of the selected products have an image in slot ${slot}.` }, { status: 400 })
  }

  // Enqueue the job and return immediately; the heavy S3 loop runs detached.
  let jobId: string
  try {
    const jobRow = await queryOne<{ id: string }>(
      `INSERT INTO bulk_image_jobs (status, operation, total, skipped, slot, admin_id)
       VALUES ('running', $1, $2, $3, $4, $5) RETURNING id`,
      [operation, targetIds.length, skipped, slot, admin.adminId ?? null]
    )
    jobId = jobRow!.id
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Could not create job' }, { status: 500 })
  }

  // ── background worker (fire-and-forget; not awaited) ──────────────────────────
  ;(async () => {
    type Acquired = {
      url: string
      thumbnailUrl: string
      s3Key: string
      s3ThumbnailKey: string
      fileName: string
      fileSize: number | null
      mimeType: string | null
      width: number | null
      height: number | null
    }
    const snapshot: OperationSnapshot = { products: [], variants: [], subs: [], variantUnits: [], productImages: [] }
    let done = 0
    try {
      for (const pid of targetIds) {
        const old = slotRowByProduct.get(pid)!
        // Acquire the image (upload resizes; gallery copies within the current env's S3 prefix).
        let u: Acquired
        if (hasFile) {
          const f = new File([fileBytes as ArrayBuffer], fileName, { type: fileType })
          u = await uploadProductImage(f, pid)
        } else {
          const c = await copyGalleryImageToProduct(gallery!.s3_key, gallery!.s3_thumbnail_key, pid)
          u = {
            url: c.url,
            thumbnailUrl: c.thumbnailUrl,
            s3Key: c.s3Key,
            s3ThumbnailKey: c.s3ThumbnailKey,
            fileName: gallery!.file_name,
            fileSize: gallery!.file_size,
            mimeType: gallery!.mime_type,
            width: gallery!.width,
            height: gallery!.height,
          }
        }
        // Replace the slot row in one small transaction per product, then record the
        // snapshot only after it commits (so rollback matches what actually changed).
        await withTransaction(async client => {
          await client.query(`DELETE FROM product_images WHERE id = $1`, [old.id])
          await client.query(
            `INSERT INTO product_images (
               product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
               file_name, file_size, mime_type, width, height, alt_text, display_order, is_primary
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              pid,
              u.url,
              u.thumbnailUrl,
              IMG_BUCKET,
              u.s3Key,
              u.s3ThumbnailKey,
              u.fileName,
              u.fileSize,
              u.mimeType,
              u.width,
              u.height,
              altText ?? old.alt_text,
              targetOrder,
              targetOrder === 0 ? true : old.is_primary,
            ]
          )
        })
        snapshot.productImages!.push({ product_id: pid, rows: [old as unknown as Record<string, unknown>] })
        done++
        await query(`UPDATE bulk_image_jobs SET done = $2, updated_at = NOW() WHERE id = $1`, [jobId, done]).catch(
          () => {}
        )
      }

      // Write the rollback log once, covering exactly the products that committed.
      const logRow = await queryOne<{ id: string }>(
        `INSERT INTO controls_operation_log (operation, product_ids, value, snapshot, applied_by, admin_id, product_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          operation,
          snapshot.productImages!.map(s => s.product_id),
          JSON.stringify({ slot }),
          JSON.stringify(snapshot),
          admin.email ?? null,
          admin.adminId ?? null,
          done,
        ]
      )
      await query(
        `UPDATE bulk_image_jobs SET status = 'completed', done = $2, log_id = $3, updated_at = NOW() WHERE id = $1`,
        [jobId, done, logRow?.id ?? null]
      ).catch(() => {})
    } catch (e: any) {
      await query(
        `UPDATE bulk_image_jobs SET status = 'failed', done = $2, error = $3, updated_at = NOW() WHERE id = $1`,
        [jobId, done, e?.message || 'Image update failed']
      ).catch(() => {})
    }
  })()

  return NextResponse.json({ success: true, job_id: jobId, total: targetIds.length, skipped })
}
