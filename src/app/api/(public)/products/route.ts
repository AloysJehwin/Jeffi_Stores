import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'
import { buildProductSearchClause, buildProductSearchRank, buildSearchRank } from '@/lib/catalog/search'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

const PAGE_SIZE = 21

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() || ''
    const categorySlug = searchParams.get('category')?.trim() || ''
    const brand = searchParams.get('brand')?.trim() || ''
    const sort = searchParams.get('sort') || ''
    const order = searchParams.get('order') === 'asc' ? 'ASC' : 'DESC'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || String(PAGE_SIZE), 10)))
    const offset = (page - 1) * limit

    const conditions: string[] = [
      'p.is_active = true',
      '(p.launch_date IS NULL OR p.launch_date <= CURRENT_DATE)',
      '(p.discontinue_date IS NULL OR p.discontinue_date > CURRENT_DATE)',
    ]
    const params: unknown[] = []
    let idx = 1

    if (search) {
      const sc = buildProductSearchClause(search, 'p.name', 'p.sku', 'p.search_vector', idx)
      conditions.push(sc.clause)
      params.push(...sc.params)
      idx = sc.nextIdx
    }
    if (categorySlug) {
      conditions.push(`p.category_id IN (
        WITH RECURSIVE cat_tree AS (
          SELECT id FROM categories WHERE slug = $${idx++}
          UNION ALL
          SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
        )
        SELECT id FROM cat_tree
      )`)
      params.push(categorySlug)
    }
    if (brand) {
      conditions.push(`p.brand_id = $${idx++}`)
      params.push(brand)
    }

    const allowedSort: Record<string, string> = {
      created_at: 'p.created_at',
      name: 'p.name',
      base_price: 'p.base_price',
    }
    const sortCol = allowedSort[sort] || null
    const orderBy = sortCol
      ? `${sortCol} ${order}`
      : search
        ? (() => {
            const { rank, params: rp, nextIdx: ni } = buildProductSearchRank(search, 'p.name', 'p.search_vector', idx)
            params.push(...rp)
            idx = ni
            return `${rank}, p.name ASC`
          })()
        : `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

    const whereClause = conditions.join(' AND ')

    const { gstEnabled } = await getFeatureFlags()
    const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total FROM products p WHERE ${whereClause}`,
      params
    )
    const total = Number(countRow?.total ?? 0)

    const products = await queryMany(
      `SELECT p.*,
        json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
        json_build_object('id', b.id, 'name', b.name) AS brands,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', pi.id, 'image_url', pi.image_url, 'thumbnail_url', pi.thumbnail_url,
            'is_primary', pi.is_primary, 'display_order', pi.display_order
          ) ORDER BY pi.display_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS product_images,
        ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
        ${MIN_PRICE_SQL} AS variant_min_price,
        ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN categories pc ON c.parent_category_id = pc.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    )

    return NextResponse.json({
      products: products || [],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
