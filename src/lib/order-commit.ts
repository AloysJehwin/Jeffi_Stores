import type { PoolClient } from 'pg'
import { queryMany, queryOne, withTransaction } from './db'
import { isInterState, calculateGST } from './gst'
import type { DraftBuyNowItem, DraftCartItem } from './order-draft'

const isGSTEnabled = process.env.ENABLE_GST === 'true'

export interface CartLine {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  quantity: number
  price_at_addition: number
  buy_mode: string
  buy_unit: string | null
  products: {
    id: string
    name: string
    sku: string | null
    base_price: number
    price_ex_gst: number | null
    gst_percentage: string | number | null
    hsn_code: string | null
  }
  variant: { id: string; variant_name: string; sku: string; price: number | null; price_ex_gst: number | null } | null
  sub_variant: { id: string; sub_variant_name: string; sku: string | null; price: number | null; price_ex_gst: number | null } | null
}

export async function loadActiveCart(userId: string): Promise<CartLine[]> {
  return queryMany<CartLine>(`
    SELECT
      ci.product_id, ci.variant_id, ci.sub_variant_id, ci.quantity, ci.price_at_addition,
      ci.buy_mode, ci.buy_unit,
      json_build_object(
        'id', p.id, 'name', p.name, 'sku', p.sku,
        'base_price', p.base_price, 'price_ex_gst', p.price_ex_gst,
        'gst_percentage', p.gst_percentage, 'hsn_code', p.hsn_code
      ) AS products,
      CASE WHEN ci.variant_id IS NOT NULL THEN
        json_build_object(
          'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
          'price', pv.price, 'price_ex_gst', pv.price_ex_gst
        )
      ELSE NULL END AS variant,
      CASE WHEN ci.sub_variant_id IS NOT NULL THEN
        json_build_object(
          'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
          'price', psv.price, 'price_ex_gst', psv.price_ex_gst
        )
      ELSE NULL END AS sub_variant
    FROM cart_items ci
    LEFT JOIN products p ON ci.product_id = p.id
    LEFT JOIN product_variants pv ON ci.variant_id = pv.id
    LEFT JOIN product_sub_variants psv ON ci.sub_variant_id = psv.id
    WHERE ci.user_id = $1 AND COALESCE(ci.saved_for_later, FALSE) = FALSE
  `, [userId])
}

export function cartLineUnitPrice(item: CartLine): number {
  const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
  if (isCustomQty) return Number(item.price_at_addition)
  return Number(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
}

export function cartItemsForHash(items: CartLine[]): DraftCartItem[] {
  return items.map(i => ({
    productId: i.product_id,
    variantId: i.variant_id,
    subVariantId: i.sub_variant_id,
    quantity: Number(i.quantity),
    buyMode: i.buy_mode,
    buyUnit: i.buy_unit,
    priceAtAddition: Number(i.price_at_addition),
  }))
}

export function cartSubtotal(items: CartLine[]): number {
  return items.reduce((sum, item) => sum + cartLineUnitPrice(item) * Number(item.quantity), 0)
}

export function cartTaxAmount(items: CartLine[]): number {
  return items.reduce((sum, item) => {
    const lineTotal = cartLineUnitPrice(item) * Number(item.quantity)
    const gstRate = parseFloat(String(item.products.gst_percentage || '0'))
    return sum + (lineTotal - lineTotal / (1 + gstRate / 100))
  }, 0)
}

export async function resolveBuyNowItem(input: {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  qty: number
  buyMode?: string
  buyUnit?: string | null
}): Promise<
  | { ok: true; item: { productId: string; variantId: string | null; subVariantId: string | null; qty: number; buyMode: string; buyUnit: string | null; price: number } }
  | { ok: false; error: string }
> {
  if (!input.productId) return { ok: false, error: 'productId required' }
  const qty = Number(input.qty)
  if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) return { ok: false, error: 'Invalid qty' }
  const buyMode = ['unit', 'weight', 'length'].includes(String(input.buyMode || 'unit')) ? String(input.buyMode || 'unit') : 'unit'

  const product = await queryOne<{
    id: string
    is_active: boolean
    base_price: string | number | null
    weight_rate: string | number | null
    length_rate: string | number | null
  }>(
    `SELECT id, is_active, base_price, weight_rate, length_rate FROM products WHERE id = $1`,
    [input.productId]
  )
  if (!product || !product.is_active) return { ok: false, error: 'Product not found or inactive' }

  let variant: { id: string; price: string | number | null; weight_rate: string | number | null; length_rate: string | number | null } | null = null
  if (input.variantId) {
    variant = await queryOne(
      `SELECT id, price, weight_rate, length_rate
         FROM product_variants
        WHERE id = $1 AND product_id = $2 AND is_active = TRUE`,
      [input.variantId, input.productId]
    )
    if (!variant) return { ok: false, error: 'Variant not found' }
  }

  let subVariant: { id: string; price: string | number | null } | null = null
  if (input.subVariantId) {
    subVariant = await queryOne(
      `SELECT id, price FROM product_sub_variants
        WHERE id = $1 AND is_active = TRUE
          AND ($2::uuid IS NULL OR variant_id = $2::uuid)`,
      [input.subVariantId, input.variantId || null]
    )
    if (!subVariant) return { ok: false, error: 'Sub-variant not found' }
  }

  let price: number
  if (buyMode === 'weight') {
    price = Number(variant?.weight_rate ?? product.weight_rate ?? 0)
  } else if (buyMode === 'length') {
    price = Number(variant?.length_rate ?? product.length_rate ?? 0)
  } else {
    price = Number(subVariant?.price ?? variant?.price ?? product.base_price ?? 0)
  }
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Could not resolve price for this product' }
  price = Math.round(price * 100) / 100

  return {
    ok: true,
    item: {
      productId: input.productId,
      variantId: input.variantId || null,
      subVariantId: input.subVariantId || null,
      qty,
      buyMode,
      buyUnit: input.buyUnit || null,
      price,
    },
  }
}

export interface CouponValidation {
  appliedDiscount: number
  ok: boolean
  reason?: string
}

export async function validateCouponForUser(params: {
  couponId: string
  userId: string
  subtotal: number
}): Promise<CouponValidation> {
  const coupon = await queryOne<{
    id: string; discount_type: string; discount_value: number;
    min_purchase_amount: number | null; max_discount_amount: number | null;
    usage_limit: number | null; usage_limit_per_user: number | null;
    times_used: number; valid_from: string | null; valid_until: string | null; is_active: boolean;
  }>(`SELECT * FROM coupons WHERE id = $1`, [params.couponId])

  if (!coupon || !coupon.is_active) return { appliedDiscount: 0, ok: false, reason: 'inactive' }

  const now = new Date()
  const validFrom = coupon.valid_from ? new Date(coupon.valid_from) : null
  const validUntil = coupon.valid_until ? new Date(coupon.valid_until) : null
  if (validFrom && validFrom > now) return { appliedDiscount: 0, ok: false, reason: 'not_yet_valid' }
  if (validUntil && validUntil < now) return { appliedDiscount: 0, ok: false, reason: 'expired' }
  if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
    return { appliedDiscount: 0, ok: false, reason: 'global_limit_reached' }
  }
  if (coupon.usage_limit_per_user !== null) {
    const usage = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = $1 AND user_id = $2`,
      [coupon.id, params.userId]
    )
    if (usage && parseInt(usage.cnt, 10) >= coupon.usage_limit_per_user) {
      return { appliedDiscount: 0, ok: false, reason: 'per_user_limit_reached' }
    }
  }
  if (coupon.min_purchase_amount !== null && params.subtotal < Number(coupon.min_purchase_amount)) {
    return { appliedDiscount: 0, ok: false, reason: 'below_min_purchase' }
  }

  let appliedDiscount: number
  if (coupon.discount_type === 'percentage') {
    appliedDiscount = (params.subtotal * Number(coupon.discount_value)) / 100
    if (coupon.max_discount_amount !== null) {
      appliedDiscount = Math.min(appliedDiscount, Number(coupon.max_discount_amount))
    }
  } else {
    appliedDiscount = Number(coupon.discount_value)
  }
  appliedDiscount = Math.min(appliedDiscount, params.subtotal)
  return { appliedDiscount: Math.round(appliedDiscount * 100) / 100, ok: true }
}

export async function loadAddress(userId: string, addressId: string) {
  return queryOne<any>(
    `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  )
}

export async function getMinOrderAmount(): Promise<number> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM site_settings WHERE key = 'min_order_amount'`,
    []
  )
  return row ? parseFloat(row.value) || 0 : 0
}

interface ShippingQuoteItem {
  productId: string
  variantId?: string | null
  quantity: number
}

export async function quoteShipping(input: {
  destinationPin: string
  items: ShippingQuoteItem[]
  subtotal: number
  isCod?: boolean
}): Promise<number> {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`
  try {
    const res = await fetch(new URL('/api/shipping/rate', origin).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationPin: input.destinationPin,
        cartItems: input.items.map(i => ({
          productId: i.productId,
          variantId: i.variantId || null,
          quantity: i.quantity,
        })),
        subtotal: input.subtotal,
        isCod: !!input.isCod,
      }),
    })
    if (!res.ok) return 0
    const data = await res.json()
    const charge = Number(data?.charge)
    return Number.isFinite(charge) && charge >= 0 ? Math.round(charge * 100) / 100 : 0
  } catch {
    return 0
  }
}

export async function findExistingUnpaidRazorpayOrder(userId: string) {
  return queryOne<{ id: string; order_number: string }>(
    `SELECT o.id, o.order_number FROM orders o
     INNER JOIN payments p ON p.order_id = o.id AND p.payment_gateway = 'razorpay'
     WHERE o.user_id = $1 AND o.payment_status = 'unpaid' AND o.status = 'pending'
     ORDER BY o.created_at DESC LIMIT 1`,
    [userId]
  )
}

export interface CommitInput {
  userId: string
  user: { email: string; phone: string | null; first_name: string | null; last_name: string | null }
  addressId: string
  notes: string | null
  couponId: string | null
  shippingAmount: number
  paymentRecord: { gatewayOrderId: string; paymentId: string; signature: string; amountPaise: number } | null
}

export interface CartCommitInput extends CommitInput {
  mode: 'cart'
  cartItems: CartLine[]
  subtotal: number
  taxAmount: number
  appliedDiscount: number
}

export interface BuyNowCommitInput extends CommitInput {
  mode: 'buyNow'
  item: DraftBuyNowItem
  product: { id: string; name: string; sku: string | null; gst_percentage: string | number | null; hsn_code: string | null }
  variant: { id: string; variant_name: string; sku: string } | null
  subVariant: { id: string; sub_variant_name: string; sku: string | null } | null
  subtotal: number
  taxAmount: number
  appliedDiscount: number
}

interface InsertedOrder {
  id: string
  order_number: string
  total_amount: string
  status: string
}

async function ensureAddressOnOrder(client: PoolClient, userId: string, addressId: string) {
  const r = await client.query(
    `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  )
  return r.rows[0] || null
}

export async function commitOrder(input: CartCommitInput | BuyNowCommitInput): Promise<InsertedOrder> {
  const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  const total = Math.max(0, input.subtotal - input.appliedDiscount + input.shippingAmount)

  return withTransaction(async (client) => {
    const address = await ensureAddressOnOrder(client, input.userId, input.addressId)
    if (!address) throw new Error('Address not found')

    const customerName = `${input.user.first_name || ''} ${input.user.last_name || ''}`.trim() || 'Customer'
    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '22'
    const isIGST = isGSTEnabled ? isInterState(address.state || '', sellerStateCode) : false

    let orderTaxableAmount = 0
    let orderCgst = 0
    let orderSgst = 0
    let orderIgst = 0

    let itemRows: Array<{
      productId: string
      variantId: string | null
      subVariantId: string | null
      productName: string
      productSku: string | null
      variantName: string | null
      qty: number
      unitPrice: number
      itemTotal: number
      gstRate: number
      hsn: string | null
      gst: ReturnType<typeof calculateGST> | null
      buyMode: string
      buyUnit: string | null
    }> = []

    if (input.mode === 'cart') {
      itemRows = input.cartItems.map(item => {
        const isCustomQty = item.buy_mode === 'weight' || item.buy_mode === 'length'
        const unitPrice = isCustomQty
          ? Number(item.price_at_addition)
          : Number(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
        const qty = Number(item.quantity)
        const gstRate = parseFloat(String(item.products.gst_percentage || '0'))
        const itemTotal = unitPrice * qty
        const gst = isGSTEnabled ? calculateGST(itemTotal, gstRate, isIGST) : null
        if (gst) {
          orderTaxableAmount += gst.taxableAmount
          orderCgst += gst.cgst
          orderSgst += gst.sgst
          orderIgst += gst.igst
        }
        const productName = item.sub_variant
          ? `${item.products.name}${item.variant ? ' - ' + item.variant.variant_name : ''} - ${item.sub_variant.sub_variant_name}`
          : (item.variant ? `${item.products.name} - ${item.variant.variant_name}` : item.products.name)
        const variantName = item.sub_variant
          ? `${item.variant?.variant_name ? item.variant.variant_name + ' / ' : ''}${item.sub_variant.sub_variant_name}`
          : (item.variant?.variant_name || null)
        return {
          productId: item.product_id,
          variantId: item.variant?.id || null,
          subVariantId: item.sub_variant?.id || null,
          productName,
          productSku: item.sub_variant?.sku || item.variant?.sku || item.products.sku,
          variantName,
          qty,
          unitPrice,
          itemTotal,
          gstRate,
          hsn: isGSTEnabled ? (item.products.hsn_code || null) : null,
          gst,
          buyMode: item.buy_mode || 'unit',
          buyUnit: item.buy_unit || null,
        }
      })
    } else {
      const i = input.item
      const qty = Number(i.qty)
      const unitPrice = Number(i.price)
      const itemTotal = unitPrice * qty
      const gstRate = parseFloat(String(input.product.gst_percentage || '0'))
      const gst = isGSTEnabled ? calculateGST(itemTotal, gstRate, isIGST) : null
      if (gst) {
        orderTaxableAmount += gst.taxableAmount
        orderCgst += gst.cgst
        orderSgst += gst.sgst
        orderIgst += gst.igst
      }
      itemRows = [{
        productId: input.product.id,
        variantId: input.variant?.id || null,
        subVariantId: input.subVariant?.id || null,
        productName: input.subVariant
          ? `${input.product.name}${input.variant ? ' - ' + input.variant.variant_name : ''} - ${input.subVariant.sub_variant_name}`
          : (input.variant ? `${input.product.name} - ${input.variant.variant_name}` : input.product.name),
        productSku: input.subVariant?.sku || input.variant?.sku || input.product.sku,
        variantName: input.subVariant
          ? `${input.variant?.variant_name ? input.variant.variant_name + ' / ' : ''}${input.subVariant.sub_variant_name}`
          : (input.variant?.variant_name || null),
        qty,
        unitPrice,
        itemTotal,
        gstRate,
        hsn: isGSTEnabled ? (input.product.hsn_code || null) : null,
        gst,
        buyMode: i.buyMode || 'unit',
        buyUnit: i.buyUnit || null,
      }]
    }

    orderTaxableAmount = Math.round(orderTaxableAmount * 100) / 100
    orderCgst = Math.round(orderCgst * 100) / 100
    orderSgst = Math.round(orderSgst * 100) / 100
    orderIgst = Math.round(orderIgst * 100) / 100

    const addressSnapshot = JSON.stringify({
      full_name: address.full_name,
      phone: address.phone,
      address_line1: address.address_line1,
      address_line2: address.address_line2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country: address.country,
    })

    const paymentStatus = input.paymentRecord ? 'paid' : 'unpaid'
    const orderStatus = input.paymentRecord ? 'confirmed' : 'pending'

    const orderResult = await client.query(
      `INSERT INTO orders (
        order_number, user_id, customer_email, customer_phone, customer_name,
        status, payment_status, subtotal, discount_amount, tax_amount, shipping_amount, total_amount,
        shipping_address_id, billing_address_id, notes,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
        order_type, shipping_address_snapshot, billing_address_snapshot
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING id, order_number, total_amount, status`,
      [
        orderNumber, input.userId, input.user.email, input.user.phone, customerName,
        orderStatus, paymentStatus,
        input.subtotal, Math.round(input.appliedDiscount * 100) / 100,
        Math.round(input.taxAmount * 100) / 100, input.shippingAmount, total,
        input.addressId, input.addressId, input.notes,
        isGSTEnabled ? orderTaxableAmount : 0,
        isGSTEnabled ? orderCgst : 0, isGSTEnabled ? orderSgst : 0, isGSTEnabled ? orderIgst : 0, isIGST,
        input.mode === 'buyNow' ? 'direct' : 'cart',
        addressSnapshot, addressSnapshot,
      ]
    )
    const created = orderResult.rows[0]

    for (const r of itemRows) {
      const taxAmt = r.gst ? r.gst.totalTax : Math.round((r.itemTotal - r.itemTotal / (1 + r.gstRate / 100)) * 100) / 100
      await client.query(
        `INSERT INTO order_items (
          order_id, product_id, variant_id, sub_variant_id, product_name, product_sku, variant_name,
          quantity, unit_price, total_price, tax_amount, hsn_code, gst_rate,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, buy_mode, buy_unit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          created.id, r.productId, r.variantId, r.subVariantId, r.productName, r.productSku, r.variantName,
          r.qty, r.unitPrice, r.itemTotal, Math.round(taxAmt * 100) / 100,
          r.hsn, isGSTEnabled ? r.gstRate : null,
          r.gst ? r.gst.taxableAmount : 0,
          r.gst ? r.gst.cgst : 0,
          r.gst ? r.gst.sgst : 0,
          r.gst ? r.gst.igst : 0,
          r.buyMode, r.buyUnit,
        ]
      )
    }

    if (input.mode === 'cart') {
      await client.query(
        `DELETE FROM cart_items WHERE user_id = $1 AND COALESCE(saved_for_later, FALSE) = FALSE`,
        [input.userId]
      )
    }

    if (input.couponId && input.appliedDiscount > 0) {
      await client.query(
        `INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount) VALUES ($1, $2, $3, $4)`,
        [input.couponId, input.userId, created.id, Math.round(input.appliedDiscount * 100) / 100]
      )
      await client.query(
        `UPDATE coupons SET times_used = times_used + 1 WHERE id = $1`,
        [input.couponId]
      )
    }

    if (input.paymentRecord) {
      await client.query(
        `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
         VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)`,
        [
          created.id,
          input.paymentRecord.paymentId,
          (input.paymentRecord.amountPaise / 100).toFixed(2),
          JSON.stringify({
            razorpay_order_id: input.paymentRecord.gatewayOrderId,
            razorpay_payment_id: input.paymentRecord.paymentId,
            razorpay_signature: input.paymentRecord.signature,
          }),
        ]
      )
    }

    return created
  })
}
