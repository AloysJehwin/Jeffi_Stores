import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getUserIdForSession } from '@/lib/guest-user'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

async function resolveUserId(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  let sessionId = cookieStore.get('session_id')?.value
  let authUserId: string | undefined
  const authToken = cookieStore.get('auth_token')?.value
  if (authToken) {
    try {
      const { payload } = await jwtVerify(authToken, JWT_SECRET)
      authUserId = payload.userId as string
    } catch {}
  }
  const userId = await getUserIdForSession(sessionId, authUserId)
  if (!sessionId && !authUserId) {
    sessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    cookieStore.set('session_id', sessionId, { maxAge: 30 * 24 * 60 * 60, path: '/' })
  }
  return { userId, sessionId, authUserId }
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const { userId } = await resolveUserId(cookieStore)

    const cartItems = await queryMany(`
      SELECT
        ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug,
          'base_price', p.base_price, 'sale_price', p.sale_price,
          'gst_percentage', p.gst_percentage,
          'stock_quantity', p.stock_quantity, 'is_in_stock', p.is_in_stock,
          'product_images', COALESCE(
            (SELECT json_agg(json_build_object('thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products,
        CASE WHEN ci.variant_id IS NOT NULL THEN
          json_build_object(
            'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
            'price', pv.price, 'mrp', pv.mrp, 'sale_price', pv.sale_price,
            'wholesale_price', pv.wholesale_price, 'stock_quantity', pv.stock_quantity,
            'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
            'weight_rate', pv.weight_rate, 'weight_unit', pv.weight_unit,
            'length_rate', pv.length_rate, 'length_unit', pv.length_unit
          )
        ELSE NULL END AS variant
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.user_id = $1
    `, [userId])

    return NextResponse.json({ items: cartItems || [] })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch cart' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { productId, quantity = 1, variantId, buyMode = 'unit', buyUnit } = body

    const cookieStore = await cookies()
    const { userId } = await resolveUserId(cookieStore)

    const product = await queryOne(
      'SELECT id, base_price, sale_price, stock_quantity, weight_rate, weight_unit, length_rate, length_unit FROM products WHERE id = $1',
      [productId]
    )
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let priceAtAddition: number
    let stockToCheck: number

    if (variantId) {
      const variant = await queryOne(
        'SELECT id, price, sale_price, stock_quantity, weight_rate, weight_unit, length_rate, length_unit FROM product_variants WHERE id = $1 AND product_id = $2 AND is_active = true',
        [variantId, productId]
      )
      if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
      if (buyMode === 'weight') {
        priceAtAddition = variant.weight_rate ?? product.weight_rate ?? 0
      } else if (buyMode === 'length') {
        priceAtAddition = variant.length_rate ?? product.length_rate ?? 0
      } else {
        priceAtAddition = variant.sale_price ?? variant.price ?? product.sale_price ?? product.base_price
      }
      stockToCheck = variant.stock_quantity
    } else {
      if (buyMode === 'weight') {
        priceAtAddition = product.weight_rate ?? 0
      } else if (buyMode === 'length') {
        priceAtAddition = product.length_rate ?? 0
      } else {
        priceAtAddition = product.sale_price || product.base_price
      }
      stockToCheck = product.stock_quantity
    }

    const existingItem = await queryOne(
      'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3 AND buy_mode = $4',
      [userId, productId, variantId || null, buyMode]
    )

    if (existingItem) {
      const newQuantity = Number(existingItem.quantity) + Number(quantity)
      if (buyMode === 'unit' && stockToCheck < newQuantity) return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })
      await query('UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2', [newQuantity, existingItem.id])
      return NextResponse.json({ message: 'Cart updated', quantity: newQuantity })
    }

    if (buyMode === 'unit' && stockToCheck < quantity) return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })

    await query(
      'INSERT INTO cart_items (user_id, product_id, variant_id, quantity, price_at_addition, buy_mode, buy_unit) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, productId, variantId || null, quantity, priceAtAddition, buyMode, buyUnit || null]
    )
    return NextResponse.json({ message: 'Item added to cart' })
  } catch {
    return NextResponse.json({ error: 'Failed to add to cart' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { cartItemId, quantity } = body

    const cookieStore = await cookies()
    const { userId, sessionId, authUserId } = await resolveUserId(cookieStore)
    if (!sessionId && !authUserId) return NextResponse.json({ error: 'Session not found' }, { status: 401 })

    const cartItem = await queryOne(`
      SELECT ci.*, p.stock_quantity AS product_stock, pv.stock_quantity AS variant_stock
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      WHERE ci.id = $1 AND ci.user_id = $2
    `, [cartItemId, userId])

    if (!cartItem) return NextResponse.json({ error: 'Cart item not found' }, { status: 404 })

    const availableStock = cartItem.variant_id ? cartItem.variant_stock : cartItem.product_stock
    if (availableStock < quantity) return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })

    await query('UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2', [quantity, cartItemId])
    return NextResponse.json({ message: 'Cart updated' })
  } catch {
    return NextResponse.json({ error: 'Failed to update cart' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cartItemId = searchParams.get('id')

    const cookieStore = await cookies()
    const { userId, sessionId, authUserId } = await resolveUserId(cookieStore)
    if (!sessionId && !authUserId) return NextResponse.json({ error: 'Session not found' }, { status: 401 })

    await query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [cartItemId, userId])
    return NextResponse.json({ message: 'Item removed from cart' })
  } catch {
    return NextResponse.json({ error: 'Failed to remove from cart' }, { status: 500 })
  }
}
