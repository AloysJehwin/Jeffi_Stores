import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import {
  loadActiveCart,
  cartSubtotal,
  cartTaxAmount,
  cartItemsForHash,
  validateCouponForUser,
  loadAddress,
  getMinOrderAmount,
  findExistingUnpaidRazorpayOrder,
} from '@/lib/order-commit'
import { signDraftToken, hashCartItems } from '@/lib/order-draft'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authUser = await authenticateUser(req)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'buyNow' ? 'buyNow' : 'cart'
  const addressId = typeof body.addressId === 'string' ? body.addressId : ''
  const couponId = typeof body.couponId === 'string' && body.couponId ? body.couponId : null
  const shippingAmount = typeof body.shippingAmount === 'number' && body.shippingAmount > 0
    ? Math.round(body.shippingAmount * 100) / 100
    : 0
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null

  if (!addressId) return NextResponse.json({ error: 'addressId is required' }, { status: 400 })

  const address = await loadAddress(authUser.userId, addressId)
  if (!address) return NextResponse.json({ error: 'Address not found' }, { status: 404 })

  const existing = await findExistingUnpaidRazorpayOrder(authUser.userId)
  if (existing) {
    return NextResponse.json({
      error: 'You have an unpaid order. Please complete or cancel it before placing a new one.',
      existingOrderId: existing.id,
      existingOrderNumber: existing.order_number,
    }, { status: 409 })
  }

  let subtotal = 0
  let cartHash: string | null = null
  let cartItemIds: string[] | null = null
  let buyNowItem: any = null

  if (mode === 'cart') {
    const cart = await loadActiveCart(authUser.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    subtotal = cartSubtotal(cart)
    cartHash = hashCartItems(cartItemsForHash(cart))
    cartItemIds = cart.map(c => `${c.product_id}:${c.variant_id || ''}:${c.sub_variant_id || ''}:${c.buy_mode}`)
  } else {
    const item = body.item
    if (!item || !item.productId || !item.qty || !item.price) {
      return NextResponse.json({ error: 'Item details are required for buy now' }, { status: 400 })
    }
    const product = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE id = $1`,
      [item.productId]
    )
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    subtotal = Number(item.price) * Number(item.qty)
    buyNowItem = {
      productId: String(item.productId),
      variantId: item.variantId ? String(item.variantId) : null,
      qty: Number(item.qty),
      buyMode: typeof item.buyMode === 'string' ? item.buyMode : 'unit',
      buyUnit: item.buyUnit ? String(item.buyUnit) : null,
      price: Number(item.price),
    }
  }

  const minOrder = await getMinOrderAmount()
  if (minOrder > 0 && subtotal < minOrder) {
    return NextResponse.json({ error: `Minimum order value is ₹${minOrder}` }, { status: 400 })
  }

  let appliedDiscount = 0
  if (couponId) {
    const result = await validateCouponForUser({ couponId, userId: authUser.userId, subtotal })
    if (result.ok) appliedDiscount = result.appliedDiscount
  }

  const total = Math.max(0, subtotal - appliedDiscount + shippingAmount)

  const draftToken = await signDraftToken({
    userId: authUser.userId,
    mode,
    addressId,
    couponId,
    shippingAmount,
    cartHash,
    cartItemIds,
    buyNowItem,
    notes,
    paymentMethod: 'razorpay',
  })

  return NextResponse.json({
    draftToken,
    total,
    subtotal,
    appliedDiscount,
    shippingAmount,
  })
}
