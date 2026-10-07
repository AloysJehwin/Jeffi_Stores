import { bp } from '@/lib/shared/business-path'

export interface BuyNowInput {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  qty: number
  buyMode?: string
  buyUnit?: string | null
}

export type BuyNowResult = { ok: true; href: string } | { ok: false; error: string }

/** Starts the single-item Buy Now checkout (same intent the PDP uses); never touches the cart. */
export async function startBuyNow(
  input: BuyNowInput,
  portal: 'storefront' | 'business' = 'storefront'
): Promise<BuyNowResult> {
  const business = portal === 'business'
  try {
    const res = await fetch('/api/checkout/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(business ? { 'X-Auth-Portal': 'business' } : {}) },
      credentials: 'include',
      body: JSON.stringify({
        productId: input.productId,
        variantId: input.variantId || null,
        subVariantId: input.subVariantId || null,
        qty: input.qty,
        buyMode: input.buyMode ?? 'unit',
        buyUnit: input.buyUnit ?? null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.intent) return { ok: false, error: data?.error || 'Failed to start checkout' }
    const q = `?intent=${encodeURIComponent(data.intent)}`
    return { ok: true, href: business ? bp(`/business/checkout/review${q}`) : `/checkout/review${q}` }
  } catch {
    return { ok: false, error: 'Could not reach the server. Please try again.' }
  }
}
