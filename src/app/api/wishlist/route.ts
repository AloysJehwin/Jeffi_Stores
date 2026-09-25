import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryMany, queryOne } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { cookies } from 'next/headers'
import { getUserIdForSession } from '@/lib/guest-user'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'
import { logActivity } from '@/lib/activity'
import { parseBody, zUuid } from '@/lib/validate'

const AddWishlistSchema = z.object({
  productId: zUuid.nullish(),
  product_id: zUuid.nullish(),
  variantId: zUuid.nullish(),
}).refine(
  (d) => d.productId != null || d.product_id != null,
  { message: 'productId is required' }
)

async function resolveUserId(request: NextRequest): Promise<string> {
  const auth = await authenticateUser(request)
  if (auth?.userId) return auth.userId
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('session_id')?.value
  return getUserIdForSession(sessionId, undefined)
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request)

    const { gstEnabled } = await getFeatureFlags()
    const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

    const wishlistItems = await queryMany(`
      SELECT
        wi.id, wi.product_id, wi.created_at,
        wi.snapshot_price, wi.snapshot_in_stock,
        (p.inventory_quantity > 0) AS inventory_in_stock,
        json_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug,
          'base_price', p.base_price, 'price_ex_gst', p.price_ex_gst,
          'mrp', p.mrp, 'has_variants', p.has_variants,
          'stock_status', p.stock_status,
          'variant_stock_total', ${VARIANT_STOCK_TOTAL_SQL},
          'variant_min_price', ${MIN_PRICE_SQL},
          'variant_min_mrp', ${VARIANT_MIN_MRP_SQL},
          'fragile', p.fragile,
          'hazardous', p.hazardous,
          'flammable', p.flammable,
          'product_images', COALESCE(
            (SELECT json_agg(json_build_object('thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products
      FROM wishlist_items wi
      INNER JOIN products p ON wi.product_id = p.id AND p.is_active = true
      WHERE wi.user_id = $1
    `, [userId])

    return NextResponse.json({ items: wishlistItems || [] })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch wishlist' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsedWishlist = parseBody(AddWishlistSchema, body)
    if (!parsedWishlist.ok) return parsedWishlist.response
    const productId = parsedWishlist.data.product_id || parsedWishlist.data.productId

    const userId = await resolveUserId(request)

    const existing = await query(
      'SELECT id FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )
    if ((existing as any).rows?.length > 0) {
      return NextResponse.json({ message: 'Item already in wishlist' })
    }

    await query(
      'INSERT INTO wishlist_items (user_id, product_id) VALUES ($1, $2)',
      [userId, productId]
    )

    const auth = await authenticateUser(request)
    if (auth?.userId) {
      const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId])
      logActivity({
        userId: auth.userId,
        kind: 'wishlist_added',
        referenceId: productId,
        referenceType: 'products',
        summary: `Added "${product?.name || 'a product'}" to wishlist`,
      }).catch(() => {})
    }

    return NextResponse.json({ message: 'Item added to wishlist' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add to wishlist' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId') || searchParams.get('product_id')

    const userId = await resolveUserId(request)

    await query(
      'DELETE FROM wishlist_items WHERE product_id = $1 AND user_id = $2',
      [productId, userId]
    )

    const auth = await authenticateUser(request)
    if (auth?.userId && productId) {
      const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId])
      logActivity({
        userId: auth.userId,
        kind: 'wishlist_removed',
        referenceId: productId,
        referenceType: 'products',
        summary: `Removed "${product?.name || 'a product'}" from wishlist`,
      }).catch(() => {})
    }

    return NextResponse.json({ message: 'Item removed from wishlist' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove from wishlist' }, { status: 500 })
  }
}
