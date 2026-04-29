import { NextRequest, NextResponse } from 'next/server'
import { queryMany, withTransaction } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

const VALID_FIELDS = ['base_price', 'mrp', 'sale_price', 'wholesale_price', 'weight_rate', 'length_rate']
const VARIANT_FIELD_MAP: Record<string, string> = { base_price: 'price', mrp: 'mrp', sale_price: 'sale_price', wholesale_price: 'wholesale_price', weight_rate: 'weight_rate', length_rate: 'length_rate' }

function applyPct(val: number | null, pct: number): number | null {
  if (val == null) return null
  return Math.round(val * (1 + pct / 100) * 100) / 100
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category_id')
  const pct = parseFloat(searchParams.get('percentage') || '0')
  const fields = (searchParams.get('fields') || '').split(',').filter(f => VALID_FIELDS.includes(f))

  if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })
  if (!pct || pct <= 0) return NextResponse.json({ error: 'percentage must be > 0' }, { status: 400 })
  if (fields.length === 0) return NextResponse.json({ error: 'at least one field required' }, { status: 400 })

  const products = await queryMany(`
    SELECT
      p.id, p.name, p.has_variants,
      p.base_price, p.mrp, p.sale_price, p.wholesale_price, p.weight_rate, p.length_rate,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pv.id, 'variant_name', pv.variant_name,
          'price', pv.price, 'mrp', pv.mrp, 'sale_price', pv.sale_price,
          'wholesale_price', pv.wholesale_price, 'weight_rate', pv.weight_rate, 'length_rate', pv.length_rate
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
    ORDER BY p.name
  `, [categoryId])

  const preview = (products || []).map((p: any) => {
    const current: Record<string, number | null> = {}
    const projected: Record<string, number | null> = {}
    for (const f of fields) {
      const raw = parseFloat(p[f])
      current[f] = isNaN(raw) ? null : raw
      projected[f] = isNaN(raw) ? null : applyPct(raw, pct)
    }
    const variantRows = (p.variants || []).map((v: any) => {
      const vc: Record<string, number | null> = {}
      const vp: Record<string, number | null> = {}
      for (const f of fields) {
        const fieldKey = f === 'base_price' ? 'price' : f
        const raw = parseFloat(v[fieldKey])
        vc[f] = isNaN(raw) ? null : raw
        vp[f] = isNaN(raw) ? null : applyPct(raw, pct)
      }
      return { id: v.id, variant_name: v.variant_name, current: vc, projected: vp }
    })
    return { id: p.id, name: p.name, has_variants: p.has_variants, current, projected, variants: variantRows }
  })

  return NextResponse.json({ preview, count: preview.length })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { category_id, category_name, percentage, fields } = body

  if (!category_id || !category_name) return NextResponse.json({ error: 'category_id and category_name required' }, { status: 400 })
  if (!percentage || percentage <= 0) return NextResponse.json({ error: 'percentage must be > 0' }, { status: 400 })
  const validFields = (fields || []).filter((f: string) => VALID_FIELDS.includes(f))
  if (validFields.length === 0) return NextResponse.json({ error: 'at least one valid field required' }, { status: 400 })

  const products = await queryMany(
    `SELECT p.id, p.name, p.has_variants, p.base_price, p.mrp, p.sale_price, p.wholesale_price, p.weight_rate, p.length_rate
     FROM products p
     WHERE p.category_id = ANY(
       SELECT id FROM categories WHERE id = $1
       UNION
       SELECT id FROM categories WHERE parent_category_id = $1
     ) AND p.is_active = true
     ORDER BY p.name`,
    [category_id]
  )

  if (!products || products.length === 0) {
    return NextResponse.json({ error: 'No active products found in this category' }, { status: 400 })
  }

  const productIds = products.map((p: any) => p.id)

  try {
    await withTransaction(async (client) => {
      const snapshotProducts: any[] = []
      for (const p of products) {
        const before: Record<string, number | null> = {}
        const after: Record<string, number | null> = {}
        const setClauses: string[] = []
        const values: any[] = []
        let i = 1

        for (const f of validFields) {
          const raw = parseFloat(p[f])
          before[f] = isNaN(raw) ? null : raw
          if (!isNaN(raw) && raw > 0) {
            after[f] = applyPct(raw, percentage)
            setClauses.push(`${f} = $${i++}`)
            values.push(after[f])
          } else {
            after[f] = null
          }
        }

        snapshotProducts.push({ id: p.id, name: p.name, has_variants: p.has_variants, before, after, variants: [] })

        if (setClauses.length > 0) {
          values.push(p.id)
          await client.query(`UPDATE products SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${i}`, values)
        }
      }

      const variants = await client.query(
        `SELECT id, product_id, variant_name, price, mrp, sale_price, wholesale_price, weight_rate, length_rate
         FROM product_variants WHERE product_id = ANY($1) AND is_active = true`,
        [productIds]
      )

      for (const v of variants.rows) {
        const setClauses: string[] = []
        const values: any[] = []
        let i = 1
        const before: Record<string, number | null> = {}
        const after: Record<string, number | null> = {}

        for (const f of validFields) {
          const col = VARIANT_FIELD_MAP[f]
          const raw = parseFloat(v[col])
          before[f] = isNaN(raw) ? null : raw
          if (!isNaN(raw) && raw > 0) {
            after[f] = applyPct(raw, percentage)
            setClauses.push(`${col} = $${i++}`)
            values.push(after[f])
          } else {
            after[f] = null
          }
        }

        const productRow = snapshotProducts.find((p: any) => p.id === v.product_id)
        if (productRow) {
          productRow.variants.push({ id: v.id, variant_name: v.variant_name, before, after })
        }

        if (setClauses.length > 0) {
          values.push(v.id)
          await client.query(`UPDATE product_variants SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${i}`, values)
        }
      }

      await client.query(
        `INSERT INTO price_inflation_log (category_id, category_name, percentage, applied_fields, product_count, applied_by, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [category_id, category_name, percentage, validFields, products.length, admin.username || 'admin', JSON.stringify(snapshotProducts)]
      )
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to apply inflation' }, { status: 500 })
  }

  return NextResponse.json({ success: true, product_count: products.length })
}
