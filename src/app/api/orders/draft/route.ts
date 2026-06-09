import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
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
  resolveBuyNowItem,
  quoteShipping,
} from '@/lib/order-commit'
import { signDraftToken, hashCartItems } from '@/lib/order-draft'
import { verifyIntent } from '@/lib/checkout-intent'
import { parseBody, zUuid } from '@/lib/validate'

const DraftSchema = z.object({
  addressId: zUuid,
  mode: z.string().nullish(),
  intent: z.string().nullish(),
  item: z.any().optional(),
  couponId: z.string().nullish(),
  notes: z.string().nullish(),
})

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authUser = await authenticateUser(req)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = parseBody(DraftSchema, body)
  if (!parsed.ok) return parsed.response
  let mode: 'cart' | 'buyNow' = parsed.data.mode === 'buyNow' ? 'buyNow' : 'cart'
  let resolvedIntent: Awaited<ReturnType<typeof verifyIntent>> = null
  if (parsed.data.intent) {
    resolvedIntent = await verifyIntent(parsed.data.intent)
    if (!resolvedIntent) return NextResponse.json({ error: 'Invalid or expired intent' }, { status: 400 })
    mode = resolvedIntent.mode === 'cart' ? 'cart' : 'buyNow'
    if (resolvedIntent.mode === 'cart' && resolvedIntent.userId !== authUser.userId) {
      return NextResponse.json({ error: 'Intent does not belong to this user' }, { status: 403 })
    }
  }
  const addressId = parsed.data.addressId
  const couponId = parsed.data.couponId ?? null
  const isCod = false
  const notes = parsed.data.notes ? parsed.data.notes.trim().slice(0, 1000) : null

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
  let shippingItems: { productId: string; variantId: string | null; quantity: number }[] = []

  if (mode === 'cart') {
    const cart = await loadActiveCart(authUser.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    subtotal = cartSubtotal(cart)
    cartHash = hashCartItems(cartItemsForHash(cart))
    cartItemIds = cart.map(c => `${c.product_id}:${c.variant_id || ''}:${c.sub_variant_id || ''}:${c.buy_mode}`)
    shippingItems = cart.map(c => ({ productId: c.product_id, variantId: c.variant_id, quantity: Number(c.quantity) }))
  } else {
    let resolveInput: { productId: string; variantId: string | null; subVariantId: string | null; qty: number; buyMode?: string; buyUnit?: string | null } | null = null
    if (resolvedIntent && resolvedIntent.mode === 'buyNow') {
      resolveInput = {
        productId: resolvedIntent.productId,
        variantId: resolvedIntent.variantId,
        subVariantId: resolvedIntent.subVariantId,
        qty: resolvedIntent.qty,
        buyMode: resolvedIntent.buyMode,
        buyUnit: resolvedIntent.buyUnit,
      }
    } else {
      const item = body.item
      if (!item || !item.productId || !item.qty) {
        return NextResponse.json({ error: 'Item details are required for buy now' }, { status: 400 })
      }
      resolveInput = {
        productId: String(item.productId),
        variantId: item.variantId || null,
        subVariantId: item.subVariantId || null,
        qty: Number(item.qty),
        buyMode: item.buyMode,
        buyUnit: item.buyUnit,
      }
    }
    const resolved = await resolveBuyNowItem(resolveInput)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
    subtotal = Math.round(resolved.item.price * resolved.item.qty * 100) / 100
    buyNowItem = resolved.item
    shippingItems = [{ productId: resolved.item.productId, variantId: resolved.item.variantId, quantity: resolved.item.qty }]
  }

  const shippingAmount = address.postal_code
    ? await quoteShipping({
        destinationPin: String(address.postal_code),
        items: shippingItems,
        subtotal,
        isCod,
      })
    : 0

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
