import { NextRequest, NextResponse } from 'next/server'
import { queryMany, withTransaction } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

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
  const conditions: string[] = [
    filters.is_active === 'false' ? 'p.is_active = false' : 'p.is_active = true',
  ]
  const params: unknown[] = []

  function add(clause: string, val: unknown) {
    params.push(val)
    conditions.push(clause.replace('?', `$${params.length}`))
  }

  if (filters.category_id) {
    params.push(filters.category_id)
    const n = params.length
    conditions.push(`p.category_id = ANY(SELECT id FROM categories WHERE id = $${n}::uuid UNION SELECT id FROM categories WHERE parent_category_id = $${n}::uuid)`)
  }
  if (filters.brand_id)       add('p.brand_id = ?::uuid', filters.brand_id)
  if (filters.grade)          add('p.grade ILIKE ?', `%${filters.grade}%`)
  if (filters.condition)      add('p.condition = ?', filters.condition)
  if (filters.target_gender)  add('p.target_gender = ?', filters.target_gender)
  if (filters.shipping_class) add('p.shipping_class = ?', filters.shipping_class)
  if (filters.tax_class)      add('p.tax_class = ?', filters.tax_class)
  if (filters.hsn_code)       add('p.hsn_code = ?', filters.hsn_code)
  if (filters.is_featured === 'true')    conditions.push('p.is_featured = true')
  if (filters.is_featured === 'false')   conditions.push('p.is_featured = false')
  if (filters.is_searchable === 'true')  conditions.push('p.is_searchable = true')
  if (filters.is_searchable === 'false') conditions.push('p.is_searchable = false')
  if (filters.product_ids) {
    const ids = filters.product_ids.split(',').filter(Boolean)
    if (ids.length) { params.push(ids); conditions.push(`p.id = ANY($${params.length}::uuid[])`) }
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
  if (!hasScope(admin.role, admin.scopes, 'inflation:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { sql, params } = buildFilterQuery(sp)

  const products = await queryMany(sql, params)
  return NextResponse.json({ products: products || [] })
}

// ── POST — apply bulk operation ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { operation, value, product_ids, filters = {}, inherit_to_variants = true } = body

  if (!operation) return NextResponse.json({ error: 'operation required' }, { status: 400 })
  if (!product_ids?.length) return NextResponse.json({ error: 'product_ids required' }, { status: 400 })

  const ids: string[] = product_ids

  try {
    let updated = 0

    await withTransaction(async (client) => {

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
            const d = deriveFromMrpEx(applyPct(curMrpEx, pct), parseFloat(p.discount_pct) || 0, parseFloat(p.gst_percentage) || 0)
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
            const d = deriveFromMrpEx(applyPct(cur, pct), parseFloat(v.discount_pct) || 0, parseFloat(v.gst_percentage) || 0)
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
            const d = deriveFromMrpEx(applyPct(cur, pct), parseFloat(sv.discount_pct) || 0, parseFloat(sv.gst_percentage) || 0)
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
          `SELECT id, mrp_ex_gst, gst_percentage FROM products WHERE id=ANY($1::uuid[])`, [ids]
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
           WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true`, [ids]
        )
        for (const v of variants.rows) {
          const cur = parseFloat(v.mrp_ex_gst)
          if (!isNaN(cur) && cur > 0) {
            const d = deriveFromMrpEx(cur, disc, parseFloat(v.gst_percentage) || 0)
            await client.query(
              `UPDATE product_variants SET mrp=$1, price_ex_gst=$2, price=$3, updated_at=NOW() WHERE id=$4`,
              [d.mrp, d.price_ex_gst, d.base_price, v.id]
            )
          }
        }
      }

      // ── set MRP ex-GST directly ───────────────────────────────────────────
      else if (operation === 'set_mrp_ex_gst') {
        const mrpEx = parseFloat(value)
        if (isNaN(mrpEx) || mrpEx <= 0) throw new Error('MRP must be > 0')

        const products = await client.query(
          `SELECT id, discount_pct, gst_percentage FROM products WHERE id=ANY($1::uuid[])`, [ids]
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
      }
      else if (operation === 'set_condition') {
        await client.query(`UPDATE products SET condition=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      }
      else if (operation === 'set_shipping_class') {
        await client.query(`UPDATE products SET shipping_class=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      }
      else if (operation === 'set_handling_days') {
        const days = parseInt(value)
        if (isNaN(days) || days < 0) throw new Error('handling_days must be >= 0')
        await client.query(`UPDATE products SET handling_days=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [days, ids])
        updated = ids.length
      }
      else if (operation === 'set_warranty_months') {
        const months = parseInt(value)
        if (isNaN(months) || months < 0) throw new Error('warranty_months must be >= 0')
        await client.query(`UPDATE products SET warranty_months=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [months, ids])
        updated = ids.length
      }
      else if (operation === 'set_target_gender') {
        await client.query(`UPDATE products SET target_gender=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      }
      else if (operation === 'set_grade') {
        await client.query(`UPDATE products SET grade=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value || null, ids])
        updated = ids.length
      }
      else if (operation === 'set_hsn_code') {
        await client.query(`UPDATE products SET hsn_code=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      }
      else if (operation === 'set_country_of_origin') {
        await client.query(`UPDATE products SET country_of_origin=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value, ids])
        updated = ids.length
      }
      else if (operation === 'set_featured') {
        await client.query(`UPDATE products SET is_featured=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value === 'true', ids])
        updated = ids.length
      }
      else if (operation === 'set_searchable') {
        await client.query(`UPDATE products SET is_searchable=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value === 'true', ids])
        updated = ids.length
      }
      else if (operation === 'set_active') {
        await client.query(`UPDATE products SET is_active=$1, updated_at=NOW() WHERE id=ANY($2::uuid[])`, [value === 'true', ids])
        updated = ids.length
      }
      else if (operation === 'set_selling_unit') {
        if (!value || typeof value !== 'object') throw new Error('unit config required')
        const { unit, factor, dimension = 'count', display_label, min_qty, max_qty, qty_step } = value as any
        if (!unit) throw new Error('unit name required')
        const f = parseFloat(factor)
        if (!Number.isFinite(f) || f <= 0) throw new Error('factor must be > 0')
        const minQ = parseFloat(min_qty) || 1
        const maxQ = max_qty != null && max_qty !== '' ? parseFloat(max_qty) : null
        const stepQ = parseFloat(qty_step) || 1

        // Upsert product-level base unit row for each product
        for (const id of ids) {
          await client.query(
            `INSERT INTO product_units (product_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)
             ON CONFLICT (product_id, unit) WHERE variant_id IS NULL
             DO UPDATE SET factor=$3, dimension=$4, display_label=$5, min_qty=$6, max_qty=$7, qty_step=$8, updated_at=NOW()`,
            [id, unit, f, dimension, display_label ?? null, minQ, maxQ, stepQ]
          )
          updated++
        }

        if (inherit_to_variants) {
          // Upsert same unit row on every active variant of the selected products
          const variants = await client.query(
            `SELECT pv.id, pv.product_id FROM product_variants pv WHERE pv.product_id=ANY($1::uuid[]) AND pv.is_active=true`,
            [ids]
          )
          for (const v of variants.rows) {
            await client.query(
              `INSERT INTO product_units (product_id, variant_id, unit, factor, dimension, display_label, min_qty, max_qty, qty_step, is_base, is_purchase_default)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false)
               ON CONFLICT (variant_id, unit) WHERE variant_id IS NOT NULL
               DO UPDATE SET factor=$4, dimension=$5, display_label=$6, min_qty=$7, max_qty=$8, qty_step=$9, updated_at=NOW()`,
              [v.product_id, v.id, unit, f, dimension, display_label ?? null, minQ, maxQ, stepQ]
            )
          }
          // Also update the simple unit varchar on variants
          await client.query(
            `UPDATE product_variants SET unit=$1, updated_at=NOW() WHERE product_id=ANY($2::uuid[]) AND is_active=true`,
            [unit, ids]
          )
        }
      }
      else {
        throw new Error(`Unknown operation: ${operation}`)
      }
    })

    return NextResponse.json({ success: true, updated })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Operation failed' }, { status: 500 })
  }
}
