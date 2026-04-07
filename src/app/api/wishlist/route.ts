import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { getUserIdForSession } from '@/lib/guest-user'

// Get wishlist items for a user
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    const wishlistItems = await queryMany(`
      SELECT
        wi.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug,
          'base_price', p.base_price, 'sale_price', p.sale_price,
          'mrp', p.mrp, 'has_variants', p.has_variants,
          'stock_quantity', p.stock_quantity, 'is_in_stock', p.is_in_stock,
          'variant_stock_total', COALESCE((SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0),
          'variant_min_price', (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)),
          'product_images', COALESCE(
            (SELECT json_agg(json_build_object('thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products
      FROM wishlist_items wi
      LEFT JOIN products p ON wi.product_id = p.id
      WHERE wi.user_id = $1
    `, [userId])

    return NextResponse.json({ items: wishlistItems || [] })
  } catch (error) {
    console.error('Wishlist GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch wishlist' }, { status: 500 })
  }
}

// Add item to wishlist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { productId } = body

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    // Check if item already exists in wishlist
    const existingItem = await queryOne(
      'SELECT * FROM wishlist_items WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )

    if (existingItem) {
      return NextResponse.json({ message: 'Item already in wishlist' })
    }

    // Insert new item
    await query(
      'INSERT INTO wishlist_items (user_id, product_id) VALUES ($1, $2)',
      [userId, productId]
    )

    return NextResponse.json({ message: 'Item added to wishlist' })
  } catch (error) {
    console.error('Wishlist POST error:', error)
    return NextResponse.json({ error: 'Failed to add to wishlist' }, { status: 500 })
  }
}

// Remove item from wishlist
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    await query(
      'DELETE FROM wishlist_items WHERE product_id = $1 AND user_id = $2',
      [productId, userId]
    )

    return NextResponse.json({ message: 'Item removed from wishlist' })
  } catch (error) {
    console.error('Wishlist DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove from wishlist' }, { status: 500 })
  }
}
