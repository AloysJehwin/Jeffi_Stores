import type { PoolClient } from 'pg'
import type { MarketplaceChannel } from './types'

// Marketplace SKU -> sellable unit. Order of precedence: the store's listing mapping, then a
// sub-variant SKU (size x colour), then a variant SKU, then a product SKU. Active units win ties.

export type MatchedBy = 'listing' | 'sub_variant' | 'variant' | 'product'

export interface SkuMatch {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
  variant_name: string | null
  sub_variant_name: string | null
  hsn_code: string | null
  gst_rate: string | null
  matched_by: MatchedBy
}

const RANK: Record<MatchedBy, number> = { listing: 0, sub_variant: 1, variant: 2, product: 3 }

type Db = Pick<PoolClient, 'query'>

/** First match per SKU by precedence (rows may arrive in any order). */
export function pickMatches(rows: (SkuMatch & { sku: string; active?: boolean | null })[]): Map<string, SkuMatch> {
  const sorted = [...rows].sort((a, b) => RANK[a.matched_by] - RANK[b.matched_by] || Number(b.active !== false) - Number(a.active !== false))
  const out = new Map<string, SkuMatch>()
  for (const r of sorted) {
    if (out.has(r.sku)) continue
    out.set(r.sku, {
      product_id: r.product_id,
      variant_id: r.variant_id ?? null,
      sub_variant_id: r.sub_variant_id ?? null,
      name: r.name,
      variant_name: r.variant_name ?? null,
      sub_variant_name: r.sub_variant_name ?? null,
      hsn_code: r.hsn_code ?? null,
      gst_rate: r.gst_rate ?? null,
      matched_by: r.matched_by,
    })
  }
  return out
}

export async function matchSkus(db: Db, channel: MarketplaceChannel, skus: string[]): Promise<Map<string, SkuMatch>> {
  const list = [...new Set(skus.map(s => s.trim()).filter(Boolean))]
  if (!list.length) return new Map()
  const res = await db.query(
    `SELECT l.marketplace_sku AS sku, l.product_id, l.variant_id, l.sub_variant_id, p.name, v.variant_name, sv.sub_variant_name,
            p.hsn_code, p.gst_percentage::text AS gst_rate, 'listing' AS matched_by, true AS active
       FROM marketplace_listings l JOIN products p ON p.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN product_sub_variants sv ON sv.id = l.sub_variant_id
      WHERE l.channel = $1 AND l.marketplace_sku = ANY($2::text[])
     UNION ALL
     SELECT sv.sku, sv.product_id, sv.variant_id, sv.id, p.name, v.variant_name, sv.sub_variant_name,
            p.hsn_code, p.gst_percentage::text, 'sub_variant', (sv.is_active AND COALESCE(v.is_active, true))
       FROM product_sub_variants sv JOIN product_variants v ON v.id = sv.variant_id JOIN products p ON p.id = sv.product_id
      WHERE sv.sku = ANY($2::text[])
     UNION ALL
     SELECT v.sku, v.product_id, v.id, NULL, p.name, v.variant_name, NULL, p.hsn_code, p.gst_percentage::text, 'variant', v.is_active
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.sku = ANY($2::text[])
     UNION ALL
     SELECT p.sku, p.id, NULL, NULL, p.name, NULL, NULL, p.hsn_code, p.gst_percentage::text, 'product', true
       FROM products p WHERE p.sku = ANY($2::text[])`,
    [channel, list]
  )
  return pickMatches(res.rows)
}
