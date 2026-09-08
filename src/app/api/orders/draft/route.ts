import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { round2 } from '@/lib/gst'
import {
  loadActiveCart,
  cartSubtotal,
  cartLineUnitPrice,
  cartItemsForHash,
  validateCouponForUser,
  loadAddress,
  getMinOrderAmount,
  findExistingUnpaidRazorpayOrder,
  resolveBuyNowItem,
  quoteShipping,
} from '@/lib/order-commit'
import { signDraftToken, hashCartItems } from '@/lib/order-draft'
import { getBusinessDiscountMap } from '@/lib/business-discount'
import { verifyIntent } from '@/lib/checkout-intent'
import { getFeatureFlags } from '@/lib/site-controls'
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
  let businessDiscountAmount = 0
  let shippingItems: { productId: string; variantId: string | null; subVariantId: string | null; quantity: number }[] = []
  const { gstEnabled } = await getFeatureFlags()

  if (mode === 'cart') {
    const cart = await loadActiveCart(authUser.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    subtotal = cartSubtotal(cart, gstEnabled)
    cartHash = hashCartItems(cartItemsForHash(cart))
    cartItemIds = cart.map(c => `${c.product_id}:${c.variant_id || ''}:${c.sub_variant_id || ''}:${c.buy_mode}`)
    shippingItems = cart.map(c => ({ productId: c.product_id, variantId: c.variant_id, subVariantId: c.sub_variant_id, quantity: Number(c.quantity) }))

    const discountMap = await getBusinessDiscountMap(authUser.userId)
    if (Object.keys(discountMap).length > 0) {
      for (const item of cart) {
        const catId = item.products.category_id
        const pct = catId ? (discountMap[catId] ?? 0) : 0
        if (pct > 0) {
          const linePrice = cartLineUnitPrice(item, gstEnabled)
          businessDiscountAmount += linePrice * Number(item.quantity) * pct / 100
        }
      }
      businessDiscountAmount = round2(businessDiscountAmount)
    }
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
    const resolved = await resolveBuyNowItem({ ...resolveInput, gstEnabled })
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
    subtotal = round2(resolved.item.price * resolved.item.qty)
    buyNowItem = resolved.item
    shippingItems = [{ productId: resolved.item.productId, variantId: resolved.item.variantId, subVariantId: resolved.item.subVariantId, quantity: resolved.item.qty }]

    const productRow = await queryOne<{ category_id: string | null }>(
      `SELECT category_id FROM products WHERE id = $1`,
      [resolved.item.productId]
    )
    if (productRow?.category_id) {
      const discountMap = await getBusinessDiscountMap(authUser.userId)
      const pct = discountMap[productRow.category_id] ?? 0
      if (pct > 0) {
        businessDiscountAmount = round2(resolved.item.price * resolved.item.qty * pct / 100)
      }
    }
  }

  const quote = address.postal_code
    ? await quoteShipping({
        destinationPin: String(address.postal_code),
        items: shippingItems,
        subtotal,
        isCod,
      })
    : { shipping: 0, codFee: 0 }
  const shippingAmount = quote.shipping
  const codFeeAmount = isCod ? quote.codFee : 0

  const minOrder = await getMinOrderAmount()
  if (minOrder > 0 && subtotal < minOrder) {
    return NextResponse.json({ error: `Minimum order value is ₹${minOrder}` }, { status: 400 })
  }

  let appliedDiscount = 0
  if (couponId) {
    const result = await validateCouponForUser({ couponId, userId: authUser.userId, subtotal })
    if (result.ok) appliedDiscount = result.appliedDiscount
  }

  const total = Math.max(0, subtotal - appliedDiscount - businessDiscountAmount + shippingAmount + codFeeAmount)

  const draftToken = await signDraftToken({
    userId: authUser.userId,
    mode,
    addressId,
    couponId,
    shippingAmount,
    codFeeAmount,
    cartHash,
    cartItemIds,
    buyNowItem,
    notes,
    paymentMethod: 'razorpay',
    businessDiscountAmount,
  })

  return NextResponse.json({
    draftToken,
    total,
    subtotal,
    appliedDiscount,
    businessDiscountAmount,
    shippingAmount,
    codFeeAmount,
  })
}
