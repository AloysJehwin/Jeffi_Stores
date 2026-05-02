import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/db'

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

    const conditions: string[] = ['p.is_active = true']
    const params: unknown[] = []
    let idx = 1

    if (search) {
      conditions.push(`p.name ILIKE $${idx++}`)
      params.push(`%${search}%`)
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
      : `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

    const whereClause = conditions.join(' AND ')

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
        COALESCE(
          (SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          0
        ) AS variant_stock_total,
        (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price
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
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
