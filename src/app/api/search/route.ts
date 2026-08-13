import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'
import { authenticateUser } from '@/lib/jwt'
import { buildProductSearchClause, buildProductSearchRank, buildSearchClause } from '@/lib/search'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || ''

    if (q.length < 2) {
      return NextResponse.json({ products: [], categories: [] })
    }

    const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', 1)
    const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', sc.nextIdx)
    const catSc = buildSearchClause(q, ['name'], 1)

    const { gstEnabled } = await getFeatureFlags()
    const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

    const [products, categories] = await Promise.all([
      queryMany(`
        SELECT
          p.id, p.name, p.slug, p.base_price, p.price_ex_gst, p.has_variants,
          json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
          ${MIN_PRICE_SQL} AS variant_min_price,
          COALESCE(
            (SELECT json_agg(json_build_object('image_url', pi.image_url, 'thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          ) AS product_images
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true
          AND (p.launch_date IS NULL OR p.launch_date <= CURRENT_DATE)
          AND (p.discontinue_date IS NULL OR p.discontinue_date > CURRENT_DATE)
          AND ${sc.clause}
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
        const authUser = await authenticateUser(request)
        const userId = authUser?.userId ?? null
        await query(
          `INSERT INTO search_logs (query, results_count, user_id, session_id) VALUES ($1, $2, $3, $4)`,
          [q.slice(0, 200), productsArr.length + categoriesArr.length, userId, sessionId]
        )
      } catch {}
    })()

    return NextResponse.json({ products: productsArr, categories: categoriesArr })
  } catch (err) {
    return NextResponse.json({ products: [], categories: [] }, { status: 500 })
  }
}
