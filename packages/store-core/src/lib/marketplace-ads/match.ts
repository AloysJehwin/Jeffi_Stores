import type { PoolClient } from 'pg'
import { matchSkus } from '@/lib/marketplace/match'
import type { AdsMarket } from './columns'

// Ads product rows -> catalogue units. A SKU goes through the marketplace matcher; a style ID (no
// SKU in the report) maps to the product its listings belong to.

type Db = Pick<PoolClient, 'query'>

export interface AdProductMatch {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
}

export async function matchAdProducts(db: Db, market: AdsMarket, items: { sku: string | null; styleId: string | null }[]): Promise<Map<string, AdProductMatch>> {
  const out = new Map<string, AdProductMatch>()
  const skus = [...new Set(items.map(i => i.sku?.trim()).filter((s): s is string => !!s))]
  if (skus.length) {
    for (const [sku, m] of await matchSkus(db, market, skus)) {
      out.set(`sku:${sku}`, { product_id: m.product_id, variant_id: m.variant_id, sub_variant_id: m.sub_variant_id, name: m.name })
    }
  }
  const styles = [...new Set(items.filter(i => !i.sku?.trim() || !out.has(`sku:${i.sku.trim()}`)).map(i => i.styleId?.trim()).filter((s): s is string => !!s))]
  if (styles.length) {
    const res = await db.query(
      `SELECT DISTINCT ON (l.style_id) l.style_id, l.product_id, p.name
         FROM marketplace_listings l JOIN products p ON p.id = l.product_id
        WHERE l.channel = $1 AND l.style_id = ANY($2::text[])
        ORDER BY l.style_id, l.updated_at DESC`,
      [market, styles]
    )
    for (const r of res.rows) out.set(`style:${r.style_id}`, { product_id: r.product_id, variant_id: null, sub_variant_id: null, name: r.name })
  }
  return out
}

export function matchFor(map: Map<string, AdProductMatch>, sku: string | null, styleId: string | null): AdProductMatch | null {
  return (sku?.trim() && map.get(`sku:${sku.trim()}`)) || (styleId?.trim() && map.get(`style:${styleId.trim()}`)) || null
}
