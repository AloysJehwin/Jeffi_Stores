import { NextRequest, NextResponse } from 'next/server'
import { queryMany, withTransaction } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'

const postSchema = z.object({
  percentage: z.number().gt(0, 'percentage must be greater than 0'),
  categoryId: zUuid.nullish(),
})

function applyPct(val: number, pct: number): number {
  return round2(val * (1 + pct / 100))
}

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

const PRODUCT_COLS = ['mrp_ex_gst', 'mrp', 'price_ex_gst', 'base_price'] as const
const VARIANT_COL_MAP: Record<string, string> = {
  mrp_ex_gst: 'mrp_ex_gst', mrp: 'mrp', price_ex_gst: 'price_ex_gst',
  base_price: 'price',
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category_id')
  const pct = parseFloat(searchParams.get('percentage') || '0')
  const productIdsParam = searchParams.get('product_ids')
  const productIds = productIdsParam ? productIdsParam.split(',').filter(Boolean) : null

  if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })
  if (!pct || pct <= 0) return NextResponse.json({ error: 'percentage must be > 0' }, { status: 400 })

  const products = await queryMany(`
    SELECT
      p.id, p.name, p.has_variants,
      p.mrp_ex_gst, p.mrp, p.price_ex_gst, p.base_price,
      p.discount_pct, p.gst_percentage,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pv.id, 'variant_name', pv.variant_name,
          'mrp_ex_gst', pv.mrp_ex_gst, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
          'price', pv.price
        ) ORDER BY pv.variant_name)
        FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS variants
    FROM products p
    WHERE p.category_id = ANY(
      SELECT id FROM categories WHERE id = $1
      UNION
      SELECT id FROM categories WHERE parent_category_id = $1
    ) AND p.is_active = true
    AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
    ORDER BY p.name
  `, [categoryId, productIds])

  const preview = (products || []).map((p: any) => {
    const discPct = parseFloat(p.discount_pct) || 0
    const gstPct = parseFloat(p.gst_percentage) || 0
    const curMrpEx = parseFloat(p.mrp_ex_gst)
    const hasCurrent = !isNaN(curMrpEx) && curMrpEx > 0

    const current = {
      mrp_ex_gst: hasCurrent ? curMrpEx : null,
      mrp: parseFloat(p.mrp) || null,
      price_ex_gst: parseFloat(p.price_ex_gst) || null,
      base_price: parseFloat(p.base_price) || null,
    }
    const projected = hasCurrent
      ? deriveFromMrpEx(applyPct(curMrpEx, pct), discPct, gstPct)
      : { mrp_ex_gst: null, mrp: null, price_ex_gst: null, base_price: null }

    const variantRows = (p.variants || []).map((v: any) => {
      const vMrpEx = parseFloat(v.mrp_ex_gst)
      const hasV = !isNaN(vMrpEx) && vMrpEx > 0
      const vCurrent = {
        mrp_ex_gst: hasV ? vMrpEx : null,
        mrp: parseFloat(v.mrp) || null,
        price_ex_gst: parseFloat(v.price_ex_gst) || null,
        base_price: parseFloat(v.price) || null,
      }
      const vProjected = hasV
        ? deriveFromMrpEx(applyPct(vMrpEx, pct), discPct, gstPct)
        : { mrp_ex_gst: null, mrp: null, price_ex_gst: null, base_price: null }
      return { id: v.id, variant_name: v.variant_name, current: vCurrent, projected: vProjected }
    })
    return { id: p.id, name: p.name, has_variants: p.has_variants, current, projected, variants: variantRows }
  })

  return NextResponse.json({ preview, count: preview.length })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json()
  const { category_id, category_name, percentage, product_ids } = body

  if (!category_id || !category_name) return NextResponse.json({ error: 'category_id and category_name required' }, { status: 400 })

  const parsedPost = parseBody(postSchema, { percentage: body.percentage, categoryId: body.category_id })
  if (!parsedPost.ok) return parsedPost.response

  const filteredProductIds: string[] | null = Array.isArray(product_ids) && product_ids.length > 0 ? product_ids : null

  const products = await queryMany(
    `SELECT p.id, p.name, p.has_variants,
            p.mrp_ex_gst, p.mrp, p.price_ex_gst, p.base_price,
            p.discount_pct, p.gst_percentage
     FROM products p
     WHERE p.category_id = ANY(
       SELECT id FROM categories WHERE id = $1
       UNION
       SELECT id FROM categories WHERE parent_category_id = $1
     ) AND p.is_active = true
     AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
     ORDER BY p.name`,
    [category_id, filteredProductIds]
  )

  if (!products || products.length === 0) {
    return NextResponse.json({ error: 'No active products found in this category' }, { status: 400 })
  }

  const productIds = products.map((p: any) => p.id)

  try {
    await withTransaction(async (client) => {
      const inflationId = crypto.randomUUID()
      await client.query(`SELECT set_config('audit.inflation_id', $1, true)`, [inflationId])
      const snapshotProducts: any[] = []

      for (const p of products) {
        const discPct = parseFloat(p.discount_pct) || 0
        const gstPct = parseFloat(p.gst_percentage) || 0
        const curMrpEx = parseFloat(p.mrp_ex_gst)

        const before: Record<string, number | null> = {
          mrp_ex_gst: parseFloat(p.mrp_ex_gst) || null,
          mrp: parseFloat(p.mrp) || null,
          price_ex_gst: parseFloat(p.price_ex_gst) || null,
          base_price: parseFloat(p.base_price) || null,
        }

        if (!isNaN(curMrpEx) && curMrpEx > 0) {
          const derived = deriveFromMrpEx(applyPct(curMrpEx, percentage), discPct, gstPct)
          await client.query(
            `UPDATE products SET
               mrp_ex_gst = $1, mrp = $2, price_ex_gst = $3, base_price = $4,
               updated_at = NOW()
             WHERE id = $5`,
            [derived.mrp_ex_gst, derived.mrp, derived.price_ex_gst, derived.base_price, p.id]
          )
          snapshotProducts.push({ id: p.id, name: p.name, has_variants: p.has_variants, before, after: derived, variants: [] })
        } else {
          snapshotProducts.push({ id: p.id, name: p.name, has_variants: p.has_variants, before, after: before, variants: [] })
        }
      }

      const variants = await client.query(
        `SELECT pv.id, pv.product_id, pv.variant_name,
                pv.mrp_ex_gst, pv.mrp, pv.price_ex_gst, pv.price,
                p.discount_pct, p.gst_percentage
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.product_id = ANY($1) AND pv.is_active = true`,
        [productIds]
      )

      for (const v of variants.rows) {
        const discPct = parseFloat(v.discount_pct) || 0
        const gstPct = parseFloat(v.gst_percentage) || 0
        const curMrpEx = parseFloat(v.mrp_ex_gst)

        const before: Record<string, number | null> = {
          mrp_ex_gst: parseFloat(v.mrp_ex_gst) || null,
          mrp: parseFloat(v.mrp) || null,
          price_ex_gst: parseFloat(v.price_ex_gst) || null,
          base_price: parseFloat(v.price) || null,
        }

        const productRow = snapshotProducts.find((p: any) => p.id === v.product_id)

        if (!isNaN(curMrpEx) && curMrpEx > 0) {
          const derived = deriveFromMrpEx(applyPct(curMrpEx, percentage), discPct, gstPct)
          await client.query(
            `UPDATE product_variants SET
               mrp_ex_gst = $1, mrp = $2, price_ex_gst = $3, price = $4,
               updated_at = NOW()
             WHERE id = $5`,
            [derived.mrp_ex_gst, derived.mrp, derived.price_ex_gst, derived.base_price, v.id]
          )
          if (productRow) productRow.variants.push({ id: v.id, variant_name: v.variant_name, before, after: derived })
        } else {
          if (productRow) productRow.variants.push({ id: v.id, variant_name: v.variant_name, before, after: before })
        }
      }

      // Also inflate sub-variants
      const subVariants = await client.query(
        `SELECT psv.id, psv.variant_id, psv.sub_variant_name,
                psv.mrp_ex_gst, psv.mrp, psv.price_ex_gst, psv.price,
                p.discount_pct, p.gst_percentage
         FROM product_sub_variants psv
         JOIN product_variants pv ON pv.id = psv.variant_id
         JOIN products p ON p.id = pv.product_id
         WHERE pv.product_id = ANY($1) AND pv.is_active = true AND psv.is_active = true`,
        [productIds]
      )

      for (const sv of subVariants.rows) {
        const discPct = parseFloat(sv.discount_pct) || 0
        const gstPct = parseFloat(sv.gst_percentage) || 0
        const curMrpEx = parseFloat(sv.mrp_ex_gst)

        if (!isNaN(curMrpEx) && curMrpEx > 0) {
          const derived = deriveFromMrpEx(applyPct(curMrpEx, percentage), discPct, gstPct)
          await client.query(
            `UPDATE product_sub_variants SET
               mrp_ex_gst = $1, mrp = $2, price_ex_gst = $3, price = $4,
               updated_at = NOW()
             WHERE id = $5`,
            [derived.mrp_ex_gst, derived.mrp, derived.price_ex_gst, derived.base_price, sv.id]
          )
        }
      }

      await client.query(
        `INSERT INTO price_inflation_log (id, category_id, category_name, percentage, applied_fields, product_count, applied_by, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [inflationId, category_id, category_name, percentage, PRODUCT_COLS, products.length,
          (admin.first_name && admin.last_name ? `${admin.first_name} ${admin.last_name}` : admin.username) || 'admin',
          JSON.stringify(snapshotProducts)]
      )
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to apply inflation' }, { status: 500 })
  }

  return NextResponse.json({ success: true, product_count: products.length })
}
