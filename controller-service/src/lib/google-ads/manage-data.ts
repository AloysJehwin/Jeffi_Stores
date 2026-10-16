import { queryMany, queryOne } from '@/lib/shared/db'
import { catalogBaseUrl } from '@/lib/shared/customer-links'
import { itemLabels, MARGIN_LABELS, STOCK_LABELS, VELOCITY_LABELS } from '@/lib/merchant/custom-labels'
import { loadSalesVelocity } from '@/lib/merchant/sales-velocity'
import { LIMITS, adTextLength } from './limits'
import { freeDeliveryCallout } from './assets'
import { shipToStates, INDIA_REGION_COUNT } from './geo'

// Everything the campaign wizard needs from our own data in one read: store identity, a budget
// suggestion from recent revenue, the states we ship to, categories, brands, custom label counts
// and product images.

export interface WizardBootstrap {
  store: { name: string; baseUrl: string; logoUrl: string | null; currency: string }
  budget: { revenue30d: number; orders30d: number; dailyRevenue: number; suggestedDaily: number }
  shipTo: { states: string[]; allIndia: boolean }
  categories: { id: string; name: string; slug: string; parentId: string | null; products: number }[]
  brands: { name: string; products: number }[]
  labels: { margin: Record<string, number>; velocity: Record<string, number>; stock: Record<string, number> }
  images: { id: string; productId?: string; productName: string; url: string }[]
  merchantConnected: boolean
  /** Short store facts for AI prompts and callouts. */
  facts: string[]
}

export const AD_SPEND_SHARE = 0.1
const MIN_SUGGESTED = 200
const MAX_SUGGESTED = 50_000

/** 10% of average daily revenue over the last 30 days, rounded to ₹50 and kept in a sane band. */
export function suggestDailyBudget(revenue30d: number): number {
  const daily = revenue30d / 30
  const raw = Math.round((daily * AD_SPEND_SHARE) / 50) * 50
  return Math.min(MAX_SUGGESTED, Math.max(MIN_SUGGESTED, raw))
}

const KEPT = `payment_status = 'paid' AND status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')`

async function labelCounts(): Promise<WizardBootstrap['labels']> {
  const velocity = await loadSalesVelocity()
  const rows = await queryMany<any>(
    `SELECT p.sku, p.price_ex_gst, p.base_price, p.cost_price, p.stock_status, p.inventory_quantity, p.low_stock_threshold,
            p.created_at, p.is_active, v.sku AS v_sku, v.price_ex_gst AS v_price_ex_gst, v.price AS v_price,
            v.cost_price AS v_cost, v.stock_status AS v_stock_status, v.inventory_quantity AS v_qty
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true AND p.has_variants = true AND v.price IS NOT NULL
     WHERE COALESCE(p.is_digital, false) = false AND p.sku IS NOT NULL AND COALESCE(p.is_draft, false) = false`
  ).catch(() => [])
  const zero = (keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, 0])) as Record<string, number>
  const out = { margin: zero(MARGIN_LABELS), velocity: zero(VELOCITY_LABELS), stock: zero(STOCK_LABELS) }
  for (const r of rows) {
    const active = r.is_active !== false
    const v = r.v_sku
    const l = itemLabels(
      {
        sku: v ? r.v_sku : r.sku,
        priceExTax: v ? r.v_price_ex_gst ?? r.v_price : r.price_ex_gst ?? r.base_price,
        cost: v && Number(r.v_cost) > 0 ? r.v_cost : r.cost_price,
        stockStatus: active ? (v ? r.v_stock_status : r.stock_status) : 'Out of Stock',
        quantity: v ? r.v_qty : r.inventory_quantity,
        lowThreshold: r.low_stock_threshold,
        createdAt: r.created_at,
      },
      velocity
    )
    out.margin[l.customLabel0]++
    if (l.customLabel1) out.velocity[l.customLabel1]++
    out.stock[l.customLabel2]++
  }
  return out
}

export async function storeFacts(): Promise<string[]> {
  const facts: string[] = []
  try {
    const [{ getDeliverySettings }, { getSiteControls }] = await Promise.all([
      import('@/lib/shipping/delivery-settings'),
      import('@/lib/catalog/site-controls'),
    ])
    const [delivery, controls] = await Promise.all([getDeliverySettings(), getSiteControls()])
    const free = freeDeliveryCallout(delivery.enabled, delivery.freeThreshold)
    if (free) facts.push(free)
    if (controls.flags.codEnabled) facts.push('Cash on delivery available')
    if (controls.flags.gstEnabled) facts.push('GST invoice on every order')
  } catch {
    // Facts are a nice-to-have for prompts.
  }
  return facts
}

export async function loadWizardBootstrap(): Promise<WizardBootstrap> {
  const [baseUrl, controls, revenue, states, categories, brands, images, labels, facts, account] = await Promise.all([
    catalogBaseUrl(),
    import('@/lib/catalog/site-controls').then(m => m.getSiteControls()).catch(() => null),
    queryOne<{ revenue: string; orders: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*)::int AS orders
       FROM orders WHERE ${KEPT} AND created_at >= now() - interval '30 days'`
    ).catch(() => null),
    shipToStates(),
    queryMany<any>(
      `SELECT c.id, c.name, c.slug, c.parent_category_id, COUNT(p.id)::int AS products
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active IS NOT FALSE
       WHERE c.is_active IS NOT FALSE AND COALESCE(c.is_draft, false) = false
       GROUP BY c.id ORDER BY c.display_order NULLS LAST, c.name`
    ).catch(() => []),
    queryMany<any>(
      `SELECT b.name, COUNT(p.id)::int AS products
       FROM brands b JOIN products p ON p.brand_id = b.id AND p.is_active IS NOT FALSE
       WHERE b.is_active IS NOT FALSE GROUP BY b.id ORDER BY COUNT(p.id) DESC, b.name LIMIT 200`
    ).catch(() => []),
    queryMany<any>(
      `SELECT DISTINCT ON (p.id) pi.id, pi.image_url, p.name, p.id AS product_id
       FROM product_images pi JOIN products p ON p.id = pi.product_id
       WHERE p.is_active IS NOT FALSE AND pi.image_url LIKE 'https://%'
       ORDER BY p.id, pi.is_primary DESC NULLS LAST, pi.display_order
       LIMIT 300`
    ).catch(() => []),
    labelCounts(),
    storeFacts(),
    queryOne<{ currency_code: string | null }>(`SELECT currency_code FROM ads_account WHERE id = 1`).catch(() => null),
  ])
  const revenue30d = Number(revenue?.revenue ?? 0) || 0
  let merchantConnected = false
  try {
    const { merchantConfigured } = await import('@/lib/merchant/client')
    merchantConnected = await merchantConfigured()
  } catch {
    merchantConnected = false
  }
  const name = controls?.identity.name || 'Store'
  return {
    store: {
      name: adTextLength(name) <= LIMITS.businessName ? name : name.slice(0, LIMITS.businessName),
      baseUrl: baseUrl.replace(/\/+$/, ''),
      logoUrl: controls?.identity.logoUrl || null,
      currency: account?.currency_code || 'INR',
    },
    budget: {
      revenue30d,
      orders30d: revenue?.orders ?? 0,
      dailyRevenue: Math.round(revenue30d / 30),
      suggestedDaily: suggestDailyBudget(revenue30d),
    },
    shipTo: { states, allIndia: !states.length || states.length >= INDIA_REGION_COUNT },
    categories: categories.map(c => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parent_category_id, products: c.products })),
    brands: brands.map(b => ({ name: b.name, products: b.products })),
    labels,
    images: images.map(i => ({ id: i.id, productId: i.product_id, productName: i.name, url: i.image_url })),
    merchantConnected,
    facts,
  }
}
