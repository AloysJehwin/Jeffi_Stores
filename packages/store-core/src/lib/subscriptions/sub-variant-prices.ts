import { query, queryMany, queryOne } from '@/lib/shared/db'
import { normalizeSubscriptionPrice, normalizeSubscriptionPrices } from './sellable'

export interface SubVariantPriceEntry {
  variant_id: string
  id: string
  subscription_price: unknown
  /** interval → price; omitted = leave stored per-interval prices alone. */
  subscription_prices?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseSubVariantPriceEntries(raw: unknown): SubVariantPriceEntry[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list.filter(
    (e: any): e is SubVariantPriceEntry => !!e && typeof e.id === 'string' && typeof e.variant_id === 'string'
  )
}

const same = (a: unknown, b: number | null) => normalizeSubscriptionPrice(a) === b
const pricesJson = (e: SubVariantPriceEntry) =>
  e.subscription_prices === undefined ? null : JSON.stringify(normalizeSubscriptionPrices(e.subscription_prices))
const samePrices = (a: unknown, b: string | null) => b == null || JSON.stringify(normalizeSubscriptionPrices(a)) === b

/** Live edit (no draft): write straight to product_sub_variants. */
export async function applyLiveSubVariantPrices(productId: string, entries: SubVariantPriceEntry[]) {
  for (const e of entries) {
    if (!UUID_RE.test(e.id)) continue
    await query(
      `UPDATE product_sub_variants
          SET subscription_price = $1, subscription_prices = COALESCE($4::jsonb, subscription_prices), updated_at = NOW()
        WHERE id = $2 AND product_id = $3
          AND (subscription_price IS DISTINCT FROM $1 OR subscription_prices IS DISTINCT FROM COALESCE($4::jsonb, subscription_prices))`,
      [normalizeSubscriptionPrice(e.subscription_price), e.id, productId, pricesJson(e)]
    )
  }
}

/** Draft edit: stage on product_drafts.sub_variants (seeding a variant's live set first, like the sub-variant API). */
export async function applyDraftSubVariantPrices(draftId: string, entries: SubVariantPriceEntry[]) {
  if (entries.length === 0) return
  const row = await queryOne<{ sub_variants: any[] | null; product_id: string }>(
    `SELECT sub_variants, product_id FROM product_drafts WHERE id = $1`,
    [draftId]
  )
  if (!row) return
  const productId = row.product_id
  let all: any[] = Array.isArray(row.sub_variants) ? row.sub_variants : []
  let changed = false
  for (const e of entries) {
    const price = normalizeSubscriptionPrice(e.subscription_price)
    const prices = pricesJson(e)
    const unchanged = (sv: any) => same(sv.subscription_price, price) && samePrices(sv.subscription_prices, prices)
    let idx = all.findIndex(sv => !sv._cleared && sv.id === e.id)
    if (idx < 0) {
      if (all.some(sv => sv.variant_id === e.variant_id) || !UUID_RE.test(e.id) || !UUID_RE.test(e.variant_id)) continue
      const live = await queryMany<any>(
        `SELECT * FROM product_sub_variants WHERE variant_id = $1 AND product_id = $2 ORDER BY created_at ASC`,
        [e.variant_id, productId]
      )
      if (!live.some(sv => sv.id === e.id && !unchanged(sv))) continue
      all = [...all, ...live.map(sv => ({ ...sv, _seeded: true }))]
      idx = all.findIndex(sv => sv.id === e.id)
    }
    if (unchanged(all[idx])) continue
    all = all.map((sv, i) =>
      i === idx
        ? {
            ...sv,
            subscription_price: price,
            ...(prices != null ? { subscription_prices: JSON.parse(prices) } : {}),
            _edited: true,
          }
        : sv
    )
    changed = true
  }
  if (!changed) return
  await query(`UPDATE product_drafts SET sub_variants = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
    draftId,
    JSON.stringify(all),
  ])
}
