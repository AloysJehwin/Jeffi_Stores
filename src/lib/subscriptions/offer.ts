import 'server-only'
import { platformBrandName } from '@/lib/catalog/brand'
import { queryOne } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { getFeatureFlags, getStoreIdentity } from '@/lib/catalog/site-controls'
import { resolveBuyNowItem, quoteShipping, loadAddress } from '@/lib/orders/order-commit'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import {
  INTERVAL_SPEC,
  MAX_CYCLE_AMOUNT_INR,
  SUBSCRIPTION_INTERVAL_LABELS,
  isSubscriptionInterval,
  type SubscriptionInterval,
} from './intervals'
import { SubscriptionError } from './types'

export const MAX_SUBSCRIPTION_QTY = 10

export interface OfferInput {
  userId: string
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  interval: unknown
  quantity: unknown
  addressId?: string | null
}

export interface SubscriptionProduct {
  id: string
  name: string
  slug: string
  is_active: boolean
  is_digital: boolean
  is_subscription: boolean
  subscription_intervals: string[] | null
  subscription_price: string | number | null
  subscription_price_ex_gst: string | number | null
  gst_percentage: string | number | null
  hsn_code: string | null
}

export interface SubscriptionOffer {
  product: SubscriptionProduct
  variantId: string | null
  subVariantId: string | null
  interval: SubscriptionInterval
  intervalLabel: string
  quantity: number
  unitPrice: number
  unitPriceExGst: number
  gstRate: number
  shipping: number
  amount: number
  amountPaise: number
  isDigital: boolean
  address: Record<string, any> | null
  collectingAccount: 'platform' | 'own'
  merchantLabel: string
  tenantId: string | null
  rzp: Awaited<ReturnType<typeof getRazorpayInstanceFor>>
}

export function snapshotAddress(a: Record<string, any>) {
  return {
    full_name: a.full_name,
    phone: a.phone,
    address_line1: a.address_line1,
    address_line2: a.address_line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    postal_code: a.postal_code,
    country: a.country,
  }
}

export function assertIndianAddress(a: Record<string, any>) {
  const c = String(a.country ?? '').trim()
  if (c && !/^(india|in|ind)$/i.test(c)) throw new SubscriptionError('Subscriptions are available in India only')
}

/** Price, interval and collecting account come ONLY from the product row — never the client. */
export async function deriveSubscriptionOffer(input: OfferInput): Promise<SubscriptionOffer> {
  const flags = await getFeatureFlags()
  if (!flags.subscriptionsEnabled) throw new SubscriptionError('Subscriptions are not available')

  const product = await queryOne<SubscriptionProduct>(
    `SELECT id, name, slug, is_active, is_digital, is_subscription, subscription_intervals,
            subscription_price, subscription_price_ex_gst, gst_percentage, hsn_code
       FROM products WHERE id = $1`,
    [input.productId]
  )
  if (!product || !product.is_active) throw new SubscriptionError('Product not found', 404)
  if (!product.is_subscription) throw new SubscriptionError('This product is not available on subscription')
  if (product.is_digital && !flags.digitalProductsEnabled) throw new SubscriptionError('This product is not available')

  if (!isSubscriptionInterval(input.interval) || !(product.subscription_intervals ?? []).includes(input.interval)) {
    throw new SubscriptionError('This subscription interval is not available for this product')
  }
  const interval = input.interval

  const isDigital = product.is_digital === true
  const rawQty = Number(input.quantity ?? 1)
  if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > MAX_SUBSCRIPTION_QTY) {
    throw new SubscriptionError(`Quantity must be between 1 and ${MAX_SUBSCRIPTION_QTY}`)
  }
  const quantity = isDigital ? 1 : rawQty

  const resolved = await resolveBuyNowItem({
    productId: product.id,
    variantId: input.variantId || null,
    subVariantId: input.subVariantId || null,
    qty: quantity,
    gstEnabled: flags.gstEnabled,
  })
  if (!resolved.ok) throw new SubscriptionError(resolved.error)

  // Each cycle is charged the live product / variant / sub-variant price.
  const unitPrice = round2(resolved.item.price)
  const gstRate = Number(product.gst_percentage ?? 0)
  const unitPriceExGst = flags.gstEnabled ? round2(unitPrice / (1 + gstRate / 100)) : unitPrice

  let address: Record<string, any> | null = null
  if (input.addressId) {
    address = await loadAddress(input.userId, input.addressId)
    if (!address) throw new SubscriptionError('Address not found', 404)
    assertIndianAddress(address)
  }

  const subtotal = round2(unitPrice * quantity)
  let shipping = 0
  if (!isDigital && address) {
    const q = await quoteShipping({
      destinationPin: String(address.postal_code ?? ''),
      items: [{ productId: product.id, variantId: input.variantId, subVariantId: input.subVariantId, quantity }],
      subtotal,
    })
    shipping = q.shipping
  }

  const amount = round2(subtotal + shipping)
  if (amount > MAX_CYCLE_AMOUNT_INR) {
    throw new SubscriptionError('Subscriptions are limited to ₹15,000 per cycle')
  }

  const tenantId = await resolveTenantId()
  const rzp = await getRazorpayInstanceFor(tenantId ?? undefined)
  const collectingAccount = rzp.creds.isOwn ? 'own' : 'platform'
  const merchantLabel = collectingAccount === 'platform' ? platformBrandName() : (await getStoreIdentity()).name

  return {
    product,
    variantId: resolved.item.variantId,
    subVariantId: resolved.item.subVariantId,
    interval,
    intervalLabel: SUBSCRIPTION_INTERVAL_LABELS[interval],
    quantity,
    unitPrice,
    unitPriceExGst,
    gstRate,
    shipping,
    amount,
    amountPaise: Math.round(amount * 100),
    isDigital,
    address,
    collectingAccount,
    merchantLabel,
    tenantId,
    rzp,
  }
}

export function intervalSpec(interval: SubscriptionInterval) {
  return INTERVAL_SPEC[interval]
}
