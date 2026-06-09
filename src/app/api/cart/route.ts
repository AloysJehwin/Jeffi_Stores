import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { getUserIdForSession } from '@/lib/guest-user'
import { recordImplicitSignal } from '@/lib/ai-feedback'
import { logActivity } from '@/lib/activity'
import { parseBody, zUuid } from '@/lib/validate'

const AddCartSchema = z
  .object({
    productId: zUuid.optional(),
    variantId: zUuid.nullish(),
    subVariantId: zUuid.nullish(),
    quantity: z.number().positive().optional(),
    buyMode: z.enum(['unit', 'weight', 'length']).nullish(),
    buyUnit: z.string().nullish(),
  })
  .refine(
    (d) => d.productId !== undefined || d.variantId !== undefined,
    { message: 'productId or variantId is required' }
  )

const UpdateCartSchema = z.object({
  cartItemId: zUuid,
  quantity: z.number().int().min(0).optional(),
  savedForLater: z.boolean().optional(),
})

async function resolveUserId(request: NextRequest) {
  const cookieStore = await cookies()
  let sessionId = cookieStore.get('session_id')?.value
  const authResult = await authenticateUser(request)
  const authUserId = authResult?.userId
  const userId = await getUserIdForSession(sessionId, authUserId)
  if (!sessionId && !authUserId) {
    sessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    cookieStore.set('session_id', sessionId, { maxAge: 30 * 24 * 60 * 60, path: '/' })
  }
  return { userId, sessionId, authUserId }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await resolveUserId(request)
    const url = new URL(request.url)
    const savedOnly = url.searchParams.get('saved') === '1'
    const savedFilter = savedOnly ? 'TRUE' : 'FALSE'

    const cartItems = await queryMany(`
      SELECT
        ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug, 'sku', p.sku,
          'base_price', p.base_price, 'price_ex_gst', p.price_ex_gst, 'mrp', p.mrp,
          'gst_percentage', p.gst_percentage,
          'stock_quantity', p.stock_quantity, 'is_in_stock', p.is_in_stock,
          'brand_name', b.name, 'category_id', p.category_id,
          'product_images', COALESCE(
            (SELECT json_agg(json_build_object('thumbnail_url', pi.thumbnail_url, 'image_url', pi.image_url, 'is_primary', pi.is_primary))
             FROM product_images pi WHERE pi.product_id = p.id),
            '[]'::json
          )
        ) AS products,
        CASE WHEN ci.variant_id IS NOT NULL THEN
          json_build_object(
            'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
            'price', pv.price, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
            'wholeprice_ex_gst', pv.wholeprice_ex_gst, 'stock_quantity', pv.stock_quantity,
            'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
            'weight_rate', pv.weight_rate, 'weight_unit', pv.weight_unit,
            'length_rate', pv.length_rate, 'length_unit', pv.length_unit
          )
        ELSE NULL END AS variant,
        CASE WHEN ci.sub_variant_id IS NOT NULL THEN
          json_build_object(
            'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
            'price', psv.price, 'mrp', psv.mrp, 'price_ex_gst', psv.price_ex_gst,
            'mrp_ex_gst', psv.mrp_ex_gst, 'wholeprice_ex_gst', psv.wholeprice_ex_gst,
            'stock_quantity', psv.stock_quantity, 'inventory_quantity', psv.inventory_quantity
          )
        ELSE NULL END AS sub_variant
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN product_variants pv ON ci.variant_id = pv.id
      LEFT JOIN product_sub_variants psv ON ci.sub_variant_id = psv.id
      WHERE ci.user_id = $1 AND COALESCE(ci.saved_for_later, FALSE) = ${savedFilter}
    `, [userId])

    return NextResponse.json({ items: cartItems || [] })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch cart' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsedCart = parseBody(AddCartSchema, body)
    if (!parsedCart.ok) return parsedCart.response
    const { productId, quantity = 1, variantId, buyMode = 'unit', buyUnit, subVariantId } = parsedCart.data

    const { userId } = await resolveUserId(request)

    const product = await queryOne(
      'SELECT id, name, base_price, price_ex_gst, weight_rate, weight_unit, length_rate, length_unit FROM products WHERE id = $1',
      [productId]
    )
    if (!productId || !product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    let priceAtAddition: number

    if (subVariantId) {
      const subVariant = await queryOne(
        'SELECT id, price FROM product_sub_variants WHERE id = $1 AND is_active = true',
        [subVariantId]
      )
      if (!subVariant) return NextResponse.json({ error: 'Sub-variant not found' }, { status: 404 })
      if (variantId) {
        const variant = await queryOne(
          'SELECT id, price FROM product_variants WHERE id = $1 AND product_id = $2 AND is_active = true',
          [variantId, productId]
        )
        if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
        priceAtAddition = subVariant.price ?? variant.price ?? product.base_price
      } else {
        priceAtAddition = subVariant.price ?? product.base_price
      }
    } else if (variantId) {
      const variant = await queryOne(
        'SELECT id, price, price_ex_gst, weight_rate, weight_unit, length_rate, length_unit FROM product_variants WHERE id = $1 AND product_id = $2 AND is_active = true',
        [variantId, productId]
      )
      if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
      if (buyMode === 'weight') {
        priceAtAddition = variant.weight_rate ?? product.weight_rate ?? 0
      } else if (buyMode === 'length') {
        priceAtAddition = variant.length_rate ?? product.length_rate ?? 0
      } else {
        priceAtAddition = variant.price ?? product.base_price
      }
    } else {
      if (buyMode === 'weight') {
        priceAtAddition = product.weight_rate ?? 0
      } else if (buyMode === 'length') {
        priceAtAddition = product.length_rate ?? 0
      } else {
        priceAtAddition = product.price_ex_gst || product.base_price
      }
    }

    const existingItem = await queryOne(
      'SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3 AND sub_variant_id IS NOT DISTINCT FROM $4 AND buy_mode = $5',
      [userId, productId, variantId || null, subVariantId || null, buyMode]
    )

    if (existingItem) {
      const newQuantity = Number(existingItem.quantity) + Number(quantity)
      await query('UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2', [newQuantity, existingItem.id])
      recordImplicitSignal(userId, productId, 'added_to_cart').catch(() => {})
      const authResult1 = await authenticateUser(request)
      const realUserId1 = authResult1?.userId
      if (realUserId1) {
        logActivity({
          userId: realUserId1,
          kind: 'cart_item_added',
          referenceId: productId,
          referenceType: 'products',
          summary: `Added "${product.name}" to cart${quantity > 1 ? ` (×${quantity})` : ''}`,
          metadata: { productId, quantity, variantId: variantId || null, buyMode },
        }).catch(() => {})
      }
      return NextResponse.json({ message: 'Cart updated', quantity: newQuantity })
    }

    await query(
      'INSERT INTO cart_items (user_id, product_id, variant_id, sub_variant_id, quantity, price_at_addition, buy_mode, buy_unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [userId, productId, variantId || null, subVariantId || null, quantity, priceAtAddition, buyMode, buyUnit || null]
    )
    recordImplicitSignal(userId, productId, 'added_to_cart').catch(() => {})

    const authResult2 = await authenticateUser(request)
    const realUserId2 = authResult2?.userId
    if (realUserId2) {
      logActivity({
        userId: realUserId2,
        kind: 'cart_item_added',
        referenceId: productId,
        referenceType: 'products',
        summary: `Added "${product.name}" to cart${quantity > 1 ? ` (×${quantity})` : ''}`,
        metadata: { productId, quantity, variantId: variantId || null, buyMode },
      }).catch(() => {})
    }

    return NextResponse.json({ message: 'Item added to cart' })
  } catch {
    return NextResponse.json({ error: 'Failed to add to cart' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const parsedUpdate = parseBody(UpdateCartSchema, body)
    if (!parsedUpdate.ok) return parsedUpdate.response
    const { cartItemId, quantity, savedForLater } = parsedUpdate.data

    const { userId, sessionId, authUserId } = await resolveUserId(request)
    if (!sessionId && !authUserId) return NextResponse.json({ error: 'Session not found' }, { status: 401 })

    const cartItem = await queryOne(`
      SELECT ci.*
      FROM cart_items ci
      WHERE ci.id = $1 AND ci.user_id = $2
    `, [cartItemId, userId])

    if (!cartItem) return NextResponse.json({ error: 'Cart item not found' }, { status: 404 })

    if (typeof savedForLater === 'boolean') {
      await query(
        'UPDATE cart_items SET saved_for_later = $1, saved_at = CASE WHEN $1 THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $2',
        [savedForLater, cartItemId]
      )
      return NextResponse.json({ message: savedForLater ? 'Saved for later' : 'Moved to cart' })
    }

    if (typeof quantity === 'number') {
      await query('UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2', [quantity, cartItemId])
      return NextResponse.json({ message: 'Cart updated' })
    }

    return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Failed to update cart' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cartItemId = searchParams.get('id')

    const { userId, sessionId, authUserId } = await resolveUserId(request)
    if (!sessionId && !authUserId) return NextResponse.json({ error: 'Session not found' }, { status: 401 })

    const cartItem = await queryOne<{ product_id: string; product_name: string }>(
      `SELECT ci.product_id::text, p.name AS product_name
         FROM cart_items ci JOIN products p ON p.id = ci.product_id
        WHERE ci.id = $1 AND ci.user_id = $2`,
      [cartItemId, userId]
    )

    await query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [cartItemId, userId])

    if (cartItem && authUserId) {
      logActivity({
        userId: authUserId,
        kind: 'cart_item_removed',
        referenceId: cartItem.product_id,
        referenceType: 'products',
        summary: `Removed "${cartItem.product_name}" from cart`,
      }).catch(() => {})
    }

    return NextResponse.json({ message: 'Item removed from cart' })
  } catch {
    return NextResponse.json({ error: 'Failed to remove from cart' }, { status: 500 })
  }
}
