import { query, queryMany, withTransaction } from '@/lib/shared/db'
import type { ListingRow, ListingTaskResult, MarketplaceAdapter } from './adapter'
import { loadSellableUnits, parseUnitKey, unitLabel, type SellableUnit } from './catalog-load'
import { resolveEndpoints } from './endpoints'
import { cellText, parseAmount, suggestColumns, type SheetData } from './sheet'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Listing mappings (which marketplace SKU / style a unit is), the SKU-report import, API submission
// in the marketplace's batch size, and the task polling that turns submissions into live/rejected.

export interface MappingInput {
  key: string
  marketplaceSku: string | null
  styleId: string | null
  category?: string | null
  listedPrice?: number | null
  listedMrp?: number | null
}

const ZERO = `'00000000-0000-0000-0000-000000000000'::uuid`
const clean = (v: unknown, max = 120) => {
  const s = cellText(v)
  return s ? s.slice(0, max) : null
}

/** Problems that stop a mapping save: bad keys, one SKU on two units, a SKU another unit already has. */
export async function mappingProblems(channel: MarketplaceChannel, inputs: MappingInput[]): Promise<string[]> {
  const problems: string[] = []
  if (!inputs.length) return ['Nothing to save.']
  if (inputs.length > 5000) return ['Save at most 5,000 rows at a time.']
  const bySku = new Map<string, string>()
  for (const i of inputs) {
    if (!parseUnitKey(i.key)) {
      problems.push('A row does not point at a product in your catalogue.')
      break
    }
    const sku = clean(i.marketplaceSku)
    if (!sku) continue
    const other = bySku.get(sku.toLowerCase())
    if (other && other !== i.key) problems.push(`${CHANNEL_LABEL[channel]} SKU ${sku} is on two rows.`)
    bySku.set(sku.toLowerCase(), i.key)
  }
  if (problems.length) return problems.slice(0, 10)
  const skus = [...bySku.keys()]
  if (!skus.length) return []
  const taken = await queryMany<{ sku: string; key: string }>(
    `SELECT marketplace_sku AS sku, product_id::text || ':' || COALESCE(variant_id::text, '') || ':' || COALESCE(sub_variant_id::text, '') AS key
       FROM marketplace_listings WHERE channel = $1 AND lower(marketplace_sku) = ANY($2::text[])`,
    [channel, skus]
  )
  const changing = new Set(inputs.map(i => i.key))
  for (const t of taken) {
    const mine = bySku.get(t.sku.toLowerCase())
    if (mine && mine !== t.key && !changing.has(t.key)) problems.push(`${CHANNEL_LABEL[channel]} SKU ${t.sku} is already mapped to another product.`)
  }
  return problems.slice(0, 10)
}

/** Upserts the mappings in one transaction. Clearing a SKU sets the listing back to unmapped. */
export async function saveListingMappings(channel: MarketplaceChannel, inputs: MappingInput[]): Promise<{ saved: number }> {
  const rows = inputs.map(i => {
    const k = parseUnitKey(i.key)!
    return {
      product_id: k.productId,
      variant_id: k.variantId,
      sub_variant_id: k.subVariantId,
      marketplace_sku: clean(i.marketplaceSku),
      style_id: clean(i.styleId),
      category: clean(i.category),
      listed_price: i.listedPrice ?? null,
      listed_mrp: i.listedMrp ?? null,
    }
  })
  const recordset = `jsonb_to_recordset($2::jsonb) AS r(product_id uuid, variant_id uuid, sub_variant_id uuid, marketplace_sku text, style_id text, category text, listed_price numeric, listed_mrp numeric)`
  await withTransaction(async db => {
    // Free the SKUs first so a swap between two units does not trip the unique index mid-statement.
    await db.query(
      `UPDATE marketplace_listings l SET marketplace_sku = NULL FROM ${recordset}
        WHERE l.channel = $1 AND l.product_id = r.product_id AND l.variant_id IS NOT DISTINCT FROM r.variant_id AND l.sub_variant_id IS NOT DISTINCT FROM r.sub_variant_id`,
      [channel, JSON.stringify(rows)]
    )
    await db.query(
      `INSERT INTO marketplace_listings (channel, product_id, variant_id, sub_variant_id, our_sku, marketplace_sku, style_id, category, listed_price, listed_mrp, status)
       SELECT $1, r.product_id, r.variant_id, r.sub_variant_id, COALESCE(sv.sku, v.sku, p.sku), r.marketplace_sku, r.style_id, r.category, r.listed_price, r.listed_mrp,
              CASE WHEN r.marketplace_sku IS NULL THEN 'unmapped' ELSE 'mapped' END
         FROM ${recordset}
         JOIN products p ON p.id = r.product_id
         LEFT JOIN product_variants v ON v.id = r.variant_id
         LEFT JOIN product_sub_variants sv ON sv.id = r.sub_variant_id
       ON CONFLICT (channel, product_id, COALESCE(variant_id, ${ZERO}), COALESCE(sub_variant_id, ${ZERO})) DO UPDATE SET
         marketplace_sku = EXCLUDED.marketplace_sku, style_id = EXCLUDED.style_id, our_sku = EXCLUDED.our_sku,
         category = COALESCE(EXCLUDED.category, marketplace_listings.category),
         listed_price = COALESCE(EXCLUDED.listed_price, marketplace_listings.listed_price),
         listed_mrp = COALESCE(EXCLUDED.listed_mrp, marketplace_listings.listed_mrp),
         status = CASE WHEN EXCLUDED.marketplace_sku IS NULL THEN 'unmapped' WHEN marketplace_listings.status = 'unmapped' THEN 'mapped' ELSE marketplace_listings.status END,
         updated_at = now()`,
      [channel, JSON.stringify(rows)]
    )
  })
  return { saved: rows.length }
}

// ── SKU report ──────────────────────────────────────────────────────────────

export type SkuReportField = 'seller_sku' | 'marketplace_sku' | 'style_id' | 'listed_price' | 'listed_mrp'

export const SKU_REPORT_SYNONYMS: Record<SkuReportField, string[]> = {
  seller_sku: ['seller sku code', 'seller sku', 'vendor sku code', 'vendor sku', 'vendor article number', 'seller article code', 'seller sku id', 'merchant sku'],
  marketplace_sku: ['myntra sku code', 'myntra sku', 'ajio sku code', 'ajio sku', 'sku id', 'skuid', 'sku code', 'product code', 'item code'],
  style_id: ['style id', 'styleid', 'style code', 'style number', 'style no'],
  listed_price: ['selling price', 'seller price', 'sp', 'listing price', 'offer price'],
  listed_mrp: ['mrp', 'maximum retail price'],
}

export interface SkuReportMatch {
  key: string
  label: string
  ourSku: string | null
  marketplaceSku: string | null
  styleId: string | null
  listedPrice: number | null
  listedMrp: number | null
  change: 'new' | 'update' | 'same'
}

/** Matches report rows to units by our SKU (the seller SKU), then by the SKU already mapped. */
export function matchSkuReport(
  units: Pick<SellableUnit, 'key' | 'name' | 'variantName' | 'subVariantName' | 'ourSku' | 'listing'>[],
  sheet: SheetData,
  columns: Partial<Record<SkuReportField, string>>
): { matches: SkuReportMatch[]; unmatched: string[] } {
  if (!columns.seller_sku && !columns.marketplace_sku) throw new Error('Pick the column with your SKU (seller SKU) or the marketplace SKU.')
  const byOurs = new Map<string, (typeof units)[number]>()
  const byMarket = new Map<string, (typeof units)[number]>()
  for (const u of units) {
    if (u.ourSku) byOurs.set(u.ourSku.trim().toLowerCase(), u)
    if (u.listing?.marketplaceSku) byMarket.set(u.listing.marketplaceSku.trim().toLowerCase(), u)
  }
  const seen = new Set<string>()
  const matches: SkuReportMatch[] = []
  const unmatched: string[] = []
  for (const row of sheet.rows) {
    const seller = columns.seller_sku ? clean(row[columns.seller_sku]) : null
    const market = columns.marketplace_sku ? clean(row[columns.marketplace_sku]) : null
    const u = (seller && byOurs.get(seller.toLowerCase())) || (market && (byMarket.get(market.toLowerCase()) ?? byOurs.get(market.toLowerCase()))) || null
    if (!u) {
      if (seller || market) unmatched.push(seller ?? market!)
      continue
    }
    if (seen.has(u.key)) continue
    seen.add(u.key)
    const marketplaceSku = market ?? seller
    const styleId = columns.style_id ? clean(row[columns.style_id]) : u.listing?.styleId ?? null
    const listedPrice = columns.listed_price ? parseAmount(row[columns.listed_price]) : null
    const listedMrp = columns.listed_mrp ? parseAmount(row[columns.listed_mrp]) : null
    const same = u.listing?.marketplaceSku === marketplaceSku && (u.listing?.styleId ?? null) === styleId
    matches.push({
      key: u.key,
      label: unitLabel(u),
      ourSku: u.ourSku,
      marketplaceSku,
      styleId,
      listedPrice,
      listedMrp,
      change: !u.listing?.marketplaceSku ? 'new' : same ? 'same' : 'update',
    })
  }
  return { matches, unmatched: [...new Set(unmatched)].slice(0, 200) }
}

export const suggestSkuColumns = (headers: string[]) => suggestColumns(headers, SKU_REPORT_SYNONYMS)

// ── Submission ──────────────────────────────────────────────────────────────

/** The row the marketplace receives for a unit (the SKU it will know us by, and the listing basics). */
export function listingRowFor(u: SellableUnit): ListingRow {
  return {
    sku: u.listing?.marketplaceSku || u.ourSku || u.key,
    styleId: u.listing?.styleId ?? null,
    attributes: {
      name: u.name,
      brand: u.brand,
      category: u.listing?.category ?? u.category,
      size: u.size,
      colour: u.colour,
      mrp: u.mrp,
      price: u.price,
      hsn: u.hsn,
      gst_rate: u.gstRate,
      gtin: u.gtin,
      description: u.description ?? u.shortDescription,
      material: u.material,
      weight_grams: u.weightGrams,
      images: u.images.join(' | ') || null,
    },
  }
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  const n = Math.max(1, Math.floor(size))
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

export interface SubmitOutcome {
  tasks: string[]
  submitted: number
  skipped: { key: string; reason: string }[]
}

/** Submits units in the marketplace's batch size; each batch becomes a task the sync cron polls. */
export async function submitUnits(
  channel: MarketplaceChannel,
  adapter: MarketplaceAdapter,
  creds: { mode?: any; endpoints?: Record<string, string> } | null,
  keys: string[]
): Promise<SubmitOutcome> {
  if (!adapter.submitListings) throw new Error(`${CHANNEL_LABEL[channel]} listing submission is not available yet. Use the template export instead.`)
  const parsed = keys.map(parseUnitKey).filter((k): k is NonNullable<typeof k> => !!k)
  const productIds = [...new Set(parsed.map(k => k.productId))]
  const wanted = new Set(keys)
  const units = (await loadSellableUnits(channel, { productIds })).filter(u => wanted.has(u.key))
  const skipped: SubmitOutcome['skipped'] = []
  const ready = units.filter(u => {
    if (!u.listing?.marketplaceSku && !u.ourSku) skipped.push({ key: u.key, reason: 'No SKU' })
    else if (u.listing?.status === 'submitted') skipped.push({ key: u.key, reason: 'Already submitted; waiting for the result' })
    else return true
    return false
  })
  if (!ready.length) return { tasks: [], submitted: 0, skipped }
  // Units submitted without a mapping are mapped to their own SKU first.
  const unmapped = ready.filter(u => !u.listing?.marketplaceSku)
  if (unmapped.length) await saveListingMappings(channel, unmapped.map(u => ({ key: u.key, marketplaceSku: u.ourSku, styleId: null })))
  const ids = new Map(
    (
      await queryMany<{ id: string; key: string }>(
        `SELECT id, product_id::text || ':' || COALESCE(variant_id::text, '') || ':' || COALESCE(sub_variant_id::text, '') AS key
           FROM marketplace_listings WHERE channel = $1 AND product_id = ANY($2::uuid[])`,
        [channel, [...new Set(ready.map(u => u.productId))]]
      )
    ).map(r => [r.key, r.id])
  )
  const size = resolveEndpoints(channel, creds).batch.listings
  const tasks: string[] = []
  let submitted = 0
  for (const batch of chunk(ready, size)) {
    const rows = batch.map(u => listingRowFor({ ...u, listing: u.listing ?? null }))
    const { taskId } = await adapter.submitListings(rows)
    const listingIds = batch.map(u => ids.get(u.key)).filter((x): x is string => !!x)
    await query(
      `INSERT INTO marketplace_listing_tasks (channel, task_id, kind, status, row_count, listing_ids) VALUES ($1, $2, 'submit', 'pending', $3, $4::uuid[])
       ON CONFLICT (channel, task_id) DO UPDATE SET status = 'pending', row_count = EXCLUDED.row_count, listing_ids = EXCLUDED.listing_ids, submitted_at = now(), completed_at = NULL`,
      [channel, taskId, batch.length, listingIds]
    )
    await query(
      `UPDATE marketplace_listings l SET status = 'submitted', last_task_id = $2, issues = '[]'::jsonb, listed_price = u.price, listed_mrp = u.mrp, updated_at = now()
         FROM jsonb_to_recordset($3::jsonb) AS u(id uuid, price numeric, mrp numeric)
        WHERE l.id = u.id AND l.channel = $1`,
      [channel, taskId, JSON.stringify(batch.map(u => ({ id: ids.get(u.key), price: u.price, mrp: u.mrp })).filter(x => x.id))]
    )
    tasks.push(taskId)
    submitted += batch.length
  }
  return { tasks, submitted, skipped }
}

/** Applies a task result: per-row live/rejected, or every row when the marketplace sends no rows. */
export function taskOutcome(result: ListingTaskResult): { final: boolean; all: 'live' | 'rejected' | null } {
  const final = result.status === 'done' || result.status === 'partial' || result.status === 'failed'
  if (!final || result.rows.length) return { final, all: null }
  return { final, all: result.status === 'failed' ? 'rejected' : 'live' }
}

/** The sync cron's pass over open submission tasks (a week at most). */
export async function pollListingTasks(channel: MarketplaceChannel, adapter: MarketplaceAdapter, limit = 20): Promise<{ checked: number; completed: number }> {
  if (!adapter.listingTask) return { checked: 0, completed: 0 }
  const open = await queryMany<{ task_id: string; listing_ids: string[] }>(
    `SELECT task_id, listing_ids FROM marketplace_listing_tasks
      WHERE channel = $1 AND status IN ('pending', 'processing') AND submitted_at > now() - interval '7 days'
      ORDER BY checked_at NULLS FIRST, submitted_at LIMIT $2`,
    [channel, limit]
  )
  let completed = 0
  for (const t of open) {
    let result: ListingTaskResult
    try {
      result = await adapter.listingTask(t.task_id)
    } catch (e) {
      await query(`UPDATE marketplace_listing_tasks SET checked_at = now(), error = $3 WHERE channel = $1 AND task_id = $2`, [channel, t.task_id, String((e as Error)?.message ?? e).slice(0, 500)])
      continue
    }
    const { final, all } = taskOutcome(result)
    const ok = result.rows.filter(r => r.ok).length
    const bad = result.rows.length - ok
    await query(
      `UPDATE marketplace_listing_tasks SET status = $3, checked_at = now(), result = $4::jsonb, success_count = $5, error_count = $6,
         error = NULL, completed_at = CASE WHEN $7 THEN now() ELSE NULL END WHERE channel = $1 AND task_id = $2`,
      [channel, t.task_id, result.status, JSON.stringify(result.rows.slice(0, 500)), all === 'live' ? t.listing_ids.length : ok, all === 'rejected' ? t.listing_ids.length : bad, final]
    )
    if (!final) continue
    completed++
    if (all) {
      await query(
        `UPDATE marketplace_listings SET status = $3, issues = CASE WHEN $3 = 'rejected' THEN '["The marketplace rejected the submission."]'::jsonb ELSE '[]'::jsonb END,
           synced_at = now(), updated_at = now() WHERE channel = $1 AND id = ANY($2::uuid[]) AND status = 'submitted'`,
        [channel, t.listing_ids, all]
      )
      continue
    }
    await query(
      `UPDATE marketplace_listings l SET status = CASE WHEN r.ok THEN 'live' ELSE 'rejected' END, issues = COALESCE(r.issues, '[]'::jsonb),
         listing_ref = COALESCE(r.ref, l.listing_ref), synced_at = now(), updated_at = now()
         FROM jsonb_to_recordset($3::jsonb) AS r(sku text, ok boolean, ref text, issues jsonb)
        WHERE l.channel = $1 AND l.id = ANY($2::uuid[]) AND lower(l.marketplace_sku) = lower(r.sku)`,
      [channel, t.listing_ids, JSON.stringify(result.rows.map(r => ({ sku: r.sku, ok: r.ok, ref: r.listingRef ?? null, issues: r.issues ?? [] })))]
    )
  }
  return { checked: open.length, completed }
}

export interface ListingTaskRow {
  task_id: string
  status: string
  row_count: number
  success_count: number
  error_count: number
  error: string | null
  submitted_at: string
  completed_at: string | null
}

export async function recentListingTasks(channel: MarketplaceChannel): Promise<ListingTaskRow[]> {
  return queryMany<ListingTaskRow>(
    `SELECT task_id, status, row_count, success_count, error_count, error, submitted_at, completed_at FROM marketplace_listing_tasks
      WHERE channel = $1 ORDER BY submitted_at DESC LIMIT 20`,
    [channel]
  ).catch(() => [])
}

