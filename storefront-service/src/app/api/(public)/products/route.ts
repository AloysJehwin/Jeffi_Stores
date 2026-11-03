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
import { positiveInt, productOrderBy, productSortSql } from '@/lib/catalog/product-sort'

const PAGE_SIZE = 21

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() || ''
    const categorySlug = searchParams.get('category')?.trim() || ''
    const brand = searchParams.get('brand')?.trim() || ''
    const sortQuery = { sort: searchParams.get('sort'), dir: searchParams.get('dir'), order: searchParams.get('order') }
    const page = positiveInt(searchParams.get('page'), 1, 100_000)
    const limit = positiveInt(searchParams.get('limit'), PAGE_SIZE, 100)
    const offset = (page - 1) * limit

    const conditions: string[] = [
      'p.is_active = true',
      'p.is_draft = false',
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

    const whereClause = conditions.join(' AND ')

    const { gstEnabled } = await getFeatureFlags()
    const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
    // The count query binds only the filter params; the search rank's params are appended after it.
    const rankParams: unknown[] = []
    let fallback: string | undefined
    if (search && !productSortSql(sortQuery, gstEnabled)) {
      const rk = buildProductSearchRank(search, 'p.name', 'p.search_vector', idx)
      rankParams.push(...rk.params)
      fallback = `${rk.rank}, p.name ASC`
    }
    const orderBy = productOrderBy(sortQuery, { gstEnabled, fallback })

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
      [...params, ...rankParams]
    )

    // Public route: never return the store's cost price, supplier link or search index.
    const publicRows = (products || []).map(({ cost_price: _c, supplier_id: _s, search_vector: _v, ...rest }: any) => rest)
    return NextResponse.json({
      products: publicRows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
