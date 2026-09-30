import { queryMany, queryOne } from './db'
import { type ProductOffer, offerHref, slugifyOffer } from './product-offers-shared'

export type { ProductOffer }
export { offerHref, slugifyOffer }

export interface ProductOfferWithCount extends ProductOffer {
  product_count: number
}

// An offer is live when active and, if a window is set, now falls inside it.
const LIVE_WINDOW = `is_active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at >= now())`

/** Offers to show to shoppers now, ordered for the home slider. */
export async function listActiveOffers(): Promise<ProductOffer[]> {
  return queryMany<ProductOffer>(
    `SELECT * FROM product_offers WHERE ${LIVE_WINDOW} ORDER BY display_order ASC, created_at ASC`
  )
}

/** Live offers holding at least one active product, for the product listing's filter. */
export async function listFilterOffers(): Promise<Pick<ProductOffer, 'slug' | 'title'>[]> {
  return queryMany<Pick<ProductOffer, 'slug' | 'title'>>(
    `SELECT o.slug, o.title FROM product_offers o
      WHERE ${LIVE_WINDOW}
        AND EXISTS (SELECT 1 FROM product_offer_items i
                      JOIN products p ON p.id = i.product_id AND p.is_active = true
                     WHERE i.offer_id = o.id)
      ORDER BY o.display_order ASC, o.created_at ASC`
  )
}

/** Active-window offers for the given ids, returned in the order of `ids`. */
export async function listOffersByIds(ids: string[]): Promise<ProductOffer[]> {
  if (ids.length === 0) return []
  const rows = await queryMany<ProductOffer>(`SELECT * FROM product_offers WHERE ${LIVE_WINDOW} AND id = ANY($1)`, [
    ids,
  ])
  const byId = new Map(rows.map(o => [o.id, o]))
  return ids.map(id => byId.get(id)).filter((o): o is ProductOffer => o != null)
}

/** Every offer for the admin manager, with how many products each holds. */
export async function listOffersAdmin(): Promise<ProductOfferWithCount[]> {
  return queryMany<ProductOfferWithCount>(
    `SELECT o.*, COUNT(i.product_id)::int AS product_count
       FROM product_offers o
       LEFT JOIN product_offer_items i ON i.offer_id = o.id
      GROUP BY o.id
      ORDER BY o.display_order ASC, o.created_at ASC`
  )
}

export async function getOfferBySlug(slug: string): Promise<ProductOffer | null> {
  return queryOne<ProductOffer>('SELECT * FROM product_offers WHERE slug = $1', [slug])
}

export async function getOfferById(id: string): Promise<ProductOffer | null> {
  return queryOne<ProductOffer>('SELECT * FROM product_offers WHERE id = $1', [id])
}
