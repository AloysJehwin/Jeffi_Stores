import type { AttentionItem } from '@/components/admin/overview/kit'
import { SOLD_LINES, num } from './catalog'

// Product offers (home-page slider offers in product_offers). Revenue with an offer = sales of
// its products while it ran; an order line under two offers counts once in the total.
// Razorpay bank offers live in Razorpay, not the DB, and are not measured here.
// Params: $1/$2 current IST days, $3/$4 previous.

const RUNNING = (o: string, t: string) =>
  `${o}.is_active AND (${o}.starts_at IS NULL OR ${o}.starts_at <= ${t}) AND (${o}.ends_at IS NULL OR ${o}.ends_at > ${t})`

export const OFFERS_SQL = `
  WITH ${SOLD_LINES},
  hit AS (
    SELECT o.id AS offer_id, s.*
    FROM sold s
    JOIN product_offer_items i ON i.product_id = s.product_id
    JOIN product_offers o ON o.id = i.offer_id
    WHERE ${RUNNING('o', 's.at')}
  )
  SELECT o.id::text AS id, o.title, o.slug, o.is_active, o.starts_at, o.ends_at,
         (NULLIF(btrim(COALESCE(o.image_url, '')), '') IS NULL) AS no_image,
         EXISTS (SELECT 1 FROM offer_drafts d WHERE d.offer_id = o.id) AS has_draft,
         (SELECT COUNT(*) FROM product_offer_items i JOIN products p ON p.id = i.product_id
          WHERE i.offer_id = o.id AND p.is_active AND NOT p.is_draft) AS products,
         CASE WHEN NOT o.is_active THEN 'hidden'
              WHEN o.ends_at IS NOT NULL AND o.ends_at <= now() THEN 'ended'
              WHEN o.starts_at IS NOT NULL AND o.starts_at > now() THEN 'scheduled'
              ELSE 'live' END AS status,
         COALESCE((SELECT SUM(h.value) FROM hit h WHERE h.offer_id = o.id AND h.cur), 0) AS sales,
         COALESCE((SELECT SUM(h.value) FROM hit h WHERE h.offer_id = o.id AND NOT h.cur), 0) AS prev_sales,
         COALESCE((SELECT SUM(h.quantity) FROM hit h WHERE h.offer_id = o.id AND h.cur), 0) AS units,
         COALESCE((SELECT COUNT(DISTINCT h.order_id) FROM hit h WHERE h.offer_id = o.id AND h.cur), 0) AS orders
  FROM product_offers o
  ORDER BY o.display_order, o.created_at DESC`

export const OFFER_TOTALS_SQL = `
  WITH ${SOLD_LINES},
  flagged AS (
    SELECT s.*, EXISTS (SELECT 1 FROM product_offer_items i JOIN product_offers o ON o.id = i.offer_id
                        WHERE i.product_id = s.product_id AND ${RUNNING('o', 's.at')}) AS with_offer
    FROM sold s
  )
  SELECT cur,
         COALESCE(SUM(value), 0) AS sales,
         COALESCE(SUM(value) FILTER (WHERE with_offer), 0) AS offer_sales,
         COUNT(DISTINCT order_id) FILTER (WHERE with_offer) AS offer_orders
  FROM flagged GROUP BY cur`

export interface OfferRow {
  id: string
  title: string
  slug: string
  status: 'live' | 'scheduled' | 'ended' | 'hidden'
  startsAt: string | null
  endsAt: string | null
  noImage: boolean
  hasDraft: boolean
  products: number
  sales: number
  prevSales: number
  units: number
  orders: number
}

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

export function toOfferRow(r: Record<string, unknown>): OfferRow {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    slug: String(r.slug ?? ''),
    status: (r.status as OfferRow['status']) ?? 'hidden',
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    noImage: !!r.no_image,
    hasDraft: !!r.has_draft,
    products: num(r.products),
    sales: num(r.sales),
    prevSales: num(r.prev_sales),
    units: num(r.units),
    orders: num(r.orders),
  }
}

export const EXPIRING_DAYS = 7

export function offerCounts(rows: OfferRow[], now = new Date()) {
  const soon = now.getTime() + EXPIRING_DAYS * 86_400_000
  const live = rows.filter(r => r.status === 'live')
  return {
    live: live.length,
    scheduled: rows.filter(r => r.status === 'scheduled').length,
    ended: rows.filter(r => r.status === 'ended').length,
    hidden: rows.filter(r => r.status === 'hidden').length,
    expiring: live.filter(r => r.endsAt && Date.parse(r.endsAt) <= soon),
    startingSoon: rows.filter(r => r.status === 'scheduled' && r.startsAt && Date.parse(r.startsAt) <= soon),
    productsOnOffer: live.reduce((a, r) => a + r.products, 0),
  }
}

const list = (rows: { title: string }[]) =>
  rows
    .slice(0, 3)
    .map(r => r.title)
    .join(', ') + (rows.length > 3 ? ` and ${rows.length - 3} more` : '')
const s = (n: number) => (n === 1 ? '' : 's')

export function offerAttention(rows: OfferRow[], now = new Date()): AttentionItem[] {
  const c = offerCounts(rows, now)
  const href = '/admin/offers?tab=offers'
  const out: AttentionItem[] = []
  const empty = rows.filter(r => r.status === 'live' && r.products === 0)
  if (empty.length)
    out.push({
      key: 'live_empty',
      severity: 'warning',
      title: `${empty.length} live offer${s(empty.length)} with no active products`,
      sub: list(empty),
      href,
    })
  if (c.expiring.length)
    out.push({
      key: 'expiring',
      severity: 'warning',
      title: `${c.expiring.length} offer${s(c.expiring.length)} ending within ${EXPIRING_DAYS} days`,
      sub: list(c.expiring),
      href,
    })
  const noImage = rows.filter(r => (r.status === 'live' || r.status === 'scheduled') && r.noImage)
  if (noImage.length)
    out.push({
      key: 'no_image',
      severity: 'warning',
      title: `${noImage.length} live or scheduled offer${s(noImage.length)} with no image`,
      sub: list(noImage),
      href,
    })
  if (c.startingSoon.length)
    out.push({
      key: 'starting',
      severity: 'info',
      title: `${c.startingSoon.length} offer${s(c.startingSoon.length)} starting within ${EXPIRING_DAYS} days`,
      sub: list(c.startingSoon),
      href,
    })
  const drafts = rows.filter(r => r.hasDraft)
  if (drafts.length)
    out.push({
      key: 'drafts',
      severity: 'info',
      title: `${drafts.length} offer${s(drafts.length)} with unpublished changes`,
      sub: list(drafts),
      href,
    })
  if (!c.live && rows.length)
    out.push({ key: 'none_live', severity: 'info', title: 'No offer is live on the storefront', href })
  return out
}
