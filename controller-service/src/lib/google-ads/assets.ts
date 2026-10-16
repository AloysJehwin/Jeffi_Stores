import sharp from 'sharp'
import { queryMany } from '@/lib/shared/db'
import { catalogBaseUrl } from '@/lib/shared/customer-links'
import type { ExtensionsSpec, PriceSpec, PromotionSpec, SitelinkSpec, SnippetSpec } from './campaign-spec'
import { filled } from './campaign-spec'
import { LIMITS, adTextLength, clipAtWord, cleanAdText } from './limits'
import { OpList, TempIds, rn, toMicros } from './mutate'

// Campaign assets (sitelinks, callouts, structured snippets, promotions, price lists) and the image
// assets Performance Max needs, plus suggestions built from the store's own data for the admin to
// approve.

const money = (amount: number, currency: string) => ({ currencyCode: currency, amountMicros: toMicros(amount) })

/** Asset creates plus their CampaignAsset links. `campaign` may be a temp resource name. */
export function extensionOps(
  customerId: string,
  campaign: string,
  x: ExtensionsSpec,
  opts: { currency?: string; ids?: TempIds; ops?: OpList } = {}
): OpList {
  const ops = opts.ops ?? new OpList()
  const ids = opts.ids ?? new TempIds()
  const currency = opts.currency || 'INR'
  const link = (asset: Record<string, any>, fieldType: string, label: string) => {
    const name = rn.asset(customerId, ids.next())
    ops.create('assetOperation', { resourceName: name, ...asset }, label)
    ops.create('campaignAssetOperation', { campaign, asset: name, fieldType }, `${label} (link)`)
  }
  x.sitelinks.forEach((s, i) => {
    const d1 = s.description1?.trim()
    const d2 = s.description2?.trim()
    link(
      {
        finalUrls: [s.finalUrl],
        sitelinkAsset: { linkText: s.linkText.trim(), ...(d1 && d2 ? { description1: d1, description2: d2 } : {}) },
      },
      'SITELINK',
      `Sitelink ${i + 1} (${s.linkText.trim()})`
    )
  })
  filled(x.callouts).forEach((c, i) => link({ calloutAsset: { calloutText: c } }, 'CALLOUT', `Callout ${i + 1} (${c})`))
  x.snippets.forEach(s =>
    link({ structuredSnippetAsset: { header: s.header, values: filled(s.values) } }, 'STRUCTURED_SNIPPET', `${s.header} snippet`)
  )
  x.promotions.forEach((p, i) => {
    const discount = p.percentOff
      ? { percentOff: String(Math.round(p.percentOff * 10_000)) }
      : { moneyAmountOff: money(p.amountOff ?? 0, currency) }
    const trigger = p.code?.trim()
      ? { promotionCode: p.code.trim() }
      : p.ordersOver
        ? { ordersOverAmount: money(p.ordersOver, currency) }
        : {}
    link(
      {
        finalUrls: [p.finalUrl],
        promotionAsset: {
          promotionTarget: p.target.trim(),
          languageCode: 'en',
          ...discount,
          ...trigger,
          ...(p.startDate ? { startDate: p.startDate } : {}),
          ...(p.endDate ? { endDate: p.endDate } : {}),
        },
      },
      'PROMOTION',
      `Promotion ${i + 1} (${p.target.trim()})`
    )
  })
  x.prices.forEach((p, i) =>
    link(
      {
        priceAsset: {
          type: p.type,
          ...(p.qualifier ? { priceQualifier: p.qualifier } : {}),
          languageCode: 'en',
          priceOfferings: p.offerings.map(o => ({
            header: o.header.trim(),
            description: o.description.trim(),
            price: money(o.price, currency),
            finalUrl: o.finalUrl,
          })),
        },
      },
      'PRICE',
      `Price list ${i + 1}`
    )
  )
  return ops
}

export const hasExtensions = (x: ExtensionsSpec | undefined) =>
  !!x && x.sitelinks.length + filled(x.callouts).length + x.snippets.length + x.promotions.length + x.prices.length > 0

// ── Images ──────────────────────────────────────────────────────────────────

export interface PreparedImages {
  /** base64 JPEG, 1200x628 (MARKETING_IMAGE, 1.91:1). */
  landscape: string[]
  /** base64 JPEG, 1200x1200 (SQUARE_MARKETING_IMAGE). */
  square: string[]
  /** base64 PNG, 512x512 (LOGO), or null when the store has none. */
  logo: string | null
  /** base64 JPEG, 960x1200 (4:5 portrait, Demand Gen), only when asked for. */
  portrait?: string[]
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new Error('Images must be served over https')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Could not download the image (HTTP ${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('The image is larger than 15 MB')
    return buf
  } finally {
    clearTimeout(t)
  }
}

/** Fit (never crop) onto a white canvas at the exact size Google's aspect-ratio check expects. */
async function fit(buf: Buffer, width: number, height: number, png = false): Promise<string> {
  const img = sharp(buf).rotate().resize(width, height, { fit: 'contain', background: WHITE }).flatten({ background: WHITE })
  return (png ? await img.png().toBuffer() : await img.jpeg({ quality: 86 }).toBuffer()).toString('base64')
}

/** Product images (by id, from our catalogue) and the store logo, shaped for Performance Max, Demand Gen and Display. */
export async function prepareImages(
  imageIds: string[],
  logoUrl: string | null,
  fetchImpl: typeof fetch = fetch,
  opts: { portrait?: boolean } = {}
): Promise<PreparedImages> {
  const rows = imageIds.length
    ? await queryMany<{ id: string; image_url: string }>(
        `SELECT id, image_url FROM product_images WHERE id = ANY($1::uuid[]) AND image_url IS NOT NULL`,
        [imageIds]
      )
    : []
  const urls = imageIds.map(id => rows.find(r => r.id === id)?.image_url).filter((u): u is string => !!u)
  const out: PreparedImages = { landscape: [], square: [], logo: null, ...(opts.portrait ? { portrait: [] } : {}) }
  for (const u of urls) {
    const buf = await fetchImage(u, fetchImpl)
    out.landscape.push(await fit(buf, 1200, 628))
    out.square.push(await fit(buf, 1200, 1200))
    out.portrait?.push(await fit(buf, 960, 1200))
  }
  if (logoUrl) out.logo = await fit(await fetchImage(logoUrl, fetchImpl), 512, 512, true)
  return out
}

/** An image asset create (name is required for image assets and kept unique). */
export function imageAsset(resourceName: string, name: string, base64: string): Record<string, any> {
  return { resourceName, name, type: 'IMAGE', imageAsset: { data: base64 } }
}

// ── Suggestions from store data ─────────────────────────────────────────────

export interface AssetSuggestions {
  sitelinks: SitelinkSpec[]
  callouts: string[]
  promotions: (PromotionSpec & { source: string })[]
  prices: PriceSpec[]
  snippets: SnippetSpec[]
  notes: string[]
}

const clip = (s: string, max: number) => {
  const t = cleanAdText(s)
  return adTextLength(t) <= max ? t : clipAtWord(t, max, 0.3) ?? t.slice(0, max).trim()
}
const day = (d: unknown) => (d ? new Date(String(d)).toISOString().slice(0, 10) : null)
const KEPT = `o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')`

/** Pull a percentage or rupee amount out of a bank offer title ("10% off on HDFC cards"). */
export function parseOfferDiscount(title: string): { percentOff: number } | { amountOff: number } | null {
  const pct = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(title)
  if (pct) return { percentOff: Number(pct[1]) }
  const amt = /(?:₹|rs\.?|inr)\s*([\d,]+)/i.exec(title)
  if (amt) {
    const n = Number(amt[1].replace(/,/g, ''))
    if (n > 0) return { amountOff: n }
  }
  return null
}

export function freeDeliveryCallout(enabled: boolean, threshold: number): string | null {
  if (!enabled) return 'Free delivery'
  if (!(threshold > 0)) return null
  const n = Math.round(threshold).toString()
  const long = `Free delivery over ₹${n}`
  return adTextLength(long) <= LIMITS.callout ? long : `Free delivery ₹${n}+`
}

export async function assetSuggestions(): Promise<AssetSuggestions> {
  const base = (await catalogBaseUrl()).replace(/\/+$/, '')
  const notes: string[] = []
  const [categories, coupons, bestsellers, brands] = await Promise.all([
    queryMany<{ name: string; slug: string }>(
      `SELECT c.name, c.slug
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id AND ${KEPT} AND o.created_at >= now() - interval '90 days'
       WHERE c.is_active IS NOT FALSE AND COALESCE(c.is_draft, false) = false
       GROUP BY c.id
       ORDER BY COALESCE(SUM(oi.total_price) FILTER (WHERE o.id IS NOT NULL), 0) DESC, c.display_order NULLS LAST, c.name
       LIMIT 6`
    ).catch(() => []),
    queryMany<any>(
      `SELECT code, discount_type, discount_value, min_purchase_amount, valid_from, valid_until
       FROM coupons c
       WHERE is_active AND NOT auto_generated AND NOT is_draft
         AND (valid_until IS NULL OR valid_until > now()) AND (valid_from IS NULL OR valid_from <= now())
         AND (usage_limit IS NULL OR COALESCE(times_used, 0) < usage_limit)
         AND NOT EXISTS (SELECT 1 FROM coupon_eligible_users e WHERE e.coupon_id = c.id)
       ORDER BY discount_value DESC LIMIT 5`
    ).catch(() => []),
    queryMany<any>(
      `SELECT p.name, p.slug, p.base_price, c.name AS category, b.name AS brand, SUM(oi.quantity) AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE ${KEPT} AND o.created_at >= now() - interval '90 days' AND p.is_active IS NOT FALSE
         AND COALESCE(p.stock_status, 'In Stock') <> 'Out of Stock' AND p.base_price > 0
       GROUP BY p.id, c.name, b.name ORDER BY SUM(oi.quantity) DESC LIMIT 8`
    ).catch(() => []),
    queryMany<{ name: string }>(
      `SELECT b.name FROM brands b JOIN products p ON p.brand_id = b.id AND p.is_active IS NOT FALSE
       WHERE b.is_active IS NOT FALSE GROUP BY b.id ORDER BY COUNT(*) DESC LIMIT 10`
    ).catch(() => []),
  ])

  const sitelinks: SitelinkSpec[] = categories.map(c => ({
    linkText: clip(c.name, LIMITS.sitelinkText),
    description1: '',
    description2: '',
    finalUrl: `${base}/categories/${c.slug}`,
  }))

  const callouts: string[] = []
  try {
    const [{ getDeliverySettings }, { getSiteControls }] = await Promise.all([
      import('@/lib/shipping/delivery-settings'),
      import('@/lib/catalog/site-controls'),
    ])
    const [delivery, controls] = await Promise.all([getDeliverySettings(), getSiteControls()])
    const free = freeDeliveryCallout(delivery.enabled, delivery.freeThreshold)
    if (free) callouts.push(free)
    if (controls.flags.codEnabled) callouts.push('Cash on delivery')
    if (controls.flags.gstEnabled) callouts.push('GST invoice available')
    if (controls.flags.razorpayEnabled) callouts.push('Secure online payments')
  } catch {
    notes.push('Store policies could not be read, so policy callouts are missing.')
  }

  const promotions: AssetSuggestions['promotions'] = coupons.map((c: any) => ({
    target: 'Sitewide',
    percentOff: c.discount_type === 'percentage' ? Math.min(100, Number(c.discount_value)) : null,
    amountOff: c.discount_type === 'percentage' ? null : Number(c.discount_value),
    code: c.code,
    ordersOver: null,
    startDate: null,
    endDate: day(c.valid_until),
    finalUrl: base,
    source: `Coupon ${c.code}${Number(c.min_purchase_amount) > 0 ? ` (min order ₹${Math.round(Number(c.min_purchase_amount))}, not shown in the ad)` : ''}`,
  }))
  try {
    const { getPublicOffers } = await import('@/lib/payments/razorpay-offers')
    const offers = await getPublicOffers()
    for (const o of offers.slice(0, 3)) {
      const d = parseOfferDiscount(o.title)
      if (!d) continue
      promotions.push({
        target: clip(o.issuers[0] ? `${o.issuers[0]} cards` : 'Card payments', LIMITS.promotionTarget),
        percentOff: 'percentOff' in d ? d.percentOff : null,
        amountOff: 'amountOff' in d ? d.amountOff : null,
        code: null,
        ordersOver: null,
        startDate: null,
        endDate: day(o.endsAt),
        finalUrl: base,
        source: `Bank offer: ${o.title}`,
      })
    }
    if (offers.length) callouts.push('Bank card offers')
  } catch {
    // Razorpay offers are optional.
  }
  if (!promotions.length) notes.push('No active public coupons or bank offers to promote.')

  const prices: PriceSpec[] =
    bestsellers.length >= 3
      ? [
          {
            type: 'PRODUCT_CATEGORIES',
            qualifier: null,
            offerings: bestsellers.map((b: any) => ({
              header: clip(b.name, LIMITS.priceHeader),
              description: clip(b.brand || b.category || 'Best seller', LIMITS.priceDescription),
              price: Math.round(Number(b.base_price)),
              finalUrl: `${base}/products/${b.slug}`,
            })),
          },
        ]
      : []
  if (!prices.length) notes.push('Price lists need at least 3 best sellers from the last 90 days.')

  const snippets: SnippetSpec[] = []
  const brandValues = brands.map(b => clip(b.name, LIMITS.snippetValue)).filter(Boolean)
  if (brandValues.length >= 3) snippets.push({ header: 'Brands', values: brandValues })
  const typeValues = categories.map(c => clip(c.name, LIMITS.snippetValue)).filter(Boolean)
  if (typeValues.length >= 3) snippets.push({ header: 'Types', values: typeValues })

  return { sitelinks, callouts: [...new Set(callouts)], promotions, prices, snippets, notes }
}
