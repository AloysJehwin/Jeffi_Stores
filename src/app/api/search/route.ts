import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { buildProductSearchClause, buildProductSearchRank, buildSearchClause } from '@/lib/search'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const JWT_SECRET = process.env.JWT_SECRET ? new TextEncoder().encode(process.env.JWT_SECRET) : null

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || ''

    if (q.length < 2) {
      return NextResponse.json({ products: [], categories: [] })
    }

    const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', 1)
    const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', sc.nextIdx)
    const catSc = buildSearchClause(q, ['name'], 1)

    const [products, categories] = await Promise.all([
      queryMany(`
        SELECT
          p.id, p.name, p.slug, p.base_price, p.price_ex_gst, p.has_variants,
          json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
          ${VARIANT_MIN_PRICE_SQL} AS variant_min_price,
          COALESCE(
            (SELECT json_agg(json_build_object('image_url', pi.image_url, 'thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          ) AS product_images
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true AND ${sc.clause}
        ORDER BY ${rk.rank}, p.name ASC
        LIMIT 6
      `, [...sc.params, ...rk.params]),
      queryMany(`
        SELECT id, name, slug FROM categories
        WHERE ${catSc.clause}
        ORDER BY name ASC
        LIMIT 3
      `, catSc.params),
    ])

    const productsArr = products || []
    const categoriesArr = categories || []

    void (async () => {
      try {
        const cookieStore = await cookies()
        const sessionId = cookieStore.get('session_id')?.value || null
        let userId: string | null = null
        const authToken = cookieStore.get('auth_token')?.value
        if (authToken && JWT_SECRET) {
          try {
            const { payload } = await jwtVerify(authToken, JWT_SECRET)
            userId = (payload.userId as string) || null
          } catch {}
        }
        await query(
          `INSERT INTO search_logs (query, results_count, user_id, session_id) VALUES ($1, $2, $3, $4)`,
          [q.slice(0, 200), productsArr.length + categoriesArr.length, userId, sessionId]
        )
      } catch {}
    })()

    return NextResponse.json({ products: productsArr, categories: categoriesArr })
  } catch {
    return NextResponse.json({ products: [], categories: [] }, { status: 500 })
  }
}
