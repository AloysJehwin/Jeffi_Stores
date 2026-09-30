import { queryMany, query } from '@/lib/db'
import { matchAsin, amazonConfigured } from './client'

// Backfill Amazon ASINs onto product variants (and simple products) by matching against the
// live Amazon catalog. READ-ONLY vs Amazon (searchCatalogItems is not brand-gated), so this is
// safe to run before any brand approval. Matching by name can hit the wrong variant, so each
// result carries a confidence/source: 'gtin' (exact barcode) or 'keyword' (fuzzy, needs review).

const CONCURRENCY = 4
const MAX_RETRIES = 3

export interface AsinBackfillRow {
  level: 'variant' | 'product'
  id: string
  sku: string
  name: string
  brand: string
  gtin: string | null
  mpn: string | null
  asin: string | null
  confidence: 'gtin' | 'keyword' | null
}

export interface AsinBackfillReport {
  scanned: number
  matched: number
  gtin: number
  keyword: number
  unmatched: number
  applied: number // rows written (0 on dry run)
  dryRun: boolean
  rows: AsinBackfillRow[] // sample (capped) for review
}

async function matchWithBackoff(input: Parameters<typeof matchAsin>[0]) {
  let attempt = 0
  for (;;) {
    try {
      return await matchAsin(input)
    } catch (err: any) {
      if (err?.status !== 429 || attempt >= MAX_RETRIES) return null
      attempt++
      const wait = (Number(err?.retryAfter) || 0) * 1000 || 1000 * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, wait))
    }
  }
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await worker(items[i++])
    })
  )
}

// Fetch ASIN-less units to match: variants of active products, plus simple (no-variant) products.
async function fetchTargets(brand: string | undefined, limit: number): Promise<AsinBackfillRow[]> {
  const brandClause = brand ? `AND b.name = $1` : ''
  const args: any[] = brand ? [brand] : []
  const variants = await queryMany<any>(
    `
    SELECT pv.id, pv.sku, pv.gtin, pv.mpn, pv.variant_name,
           p.name AS product_name, p.gtin AS product_gtin, p.mpn AS product_mpn, b.name AS brand
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.is_active = true AND pv.is_active = true AND p.has_variants = true
       AND (pv.asin IS NULL OR pv.asin = '')
       ${brandClause}
     ORDER BY p.name, pv.variant_name
     LIMIT ${limit}
  `,
    args
  ).catch(() => [])

  const simples = await queryMany<any>(
    `
    SELECT p.id, p.sku, p.gtin, p.mpn, p.name AS product_name, b.name AS brand
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.is_active = true AND p.has_variants = false AND (p.asin IS NULL OR p.asin = '')
       ${brandClause}
     ORDER BY p.name
     LIMIT ${limit}
  `,
    args
  ).catch(() => [])

  const rows: AsinBackfillRow[] = []
  for (const v of variants) {
    rows.push({
      level: 'variant',
      id: v.id,
      sku: v.sku,
      name: `${v.brand || ''} ${v.product_name} ${v.variant_name || ''}`.trim(),
      brand: v.brand || '',
      gtin: v.gtin || v.product_gtin || null,
      mpn: v.mpn || v.product_mpn || null,
      asin: null,
      confidence: null,
    })
  }
  for (const p of simples) {
    rows.push({
      level: 'product',
      id: p.id,
      sku: p.sku,
      name: `${p.brand || ''} ${p.product_name}`.trim(),
      brand: p.brand || '',
      gtin: p.gtin || null,
      mpn: p.mpn || null,
      asin: null,
      confidence: null,
    })
  }
  return rows
}

export async function backfillAsins(
  opts: { dryRun?: boolean; brand?: string; limit?: number } = {}
): Promise<AsinBackfillReport> {
  const dryRun = opts.dryRun !== false // default to dry run for safety
  const limit = Math.min(5000, Math.max(1, opts.limit || 2000))

  if (!(await amazonConfigured())) {
    return { scanned: 0, matched: 0, gtin: 0, keyword: 0, unmatched: 0, applied: 0, dryRun, rows: [] }
  }

  const targets = await fetchTargets(opts.brand, limit)

  await runPool(targets, async row => {
    const m = await matchWithBackoff({
      gtin: row.gtin || undefined,
      mpn: row.mpn || undefined,
      brand: row.brand,
      name: row.name,
    })
    if (m?.asin) {
      row.asin = m.asin
      row.confidence = m.matchType === 'gtin' ? 'gtin' : 'keyword'
    }
  })

  let applied = 0
  if (!dryRun) {
    for (const row of targets) {
      if (!row.asin) continue
      try {
        if (row.level === 'variant') {
          await query(
            `UPDATE product_variants SET asin = $1, asin_match = $2 WHERE id = $3
               AND (asin IS NULL OR asin = '' OR asin_match = 'keyword')`,
            [row.asin, row.confidence, row.id]
          )
        } else {
          await query(
            `UPDATE products SET asin = $1, asin_match = $2 WHERE id = $3
               AND (asin IS NULL OR asin = '' OR asin_match = 'keyword')`,
            [row.asin, row.confidence, row.id]
          )
        }
        applied++
      } catch {
        /* skip row on error */
      }
    }
  }

  const matched = targets.filter(r => r.asin).length
  return {
    scanned: targets.length,
    matched,
    gtin: targets.filter(r => r.confidence === 'gtin').length,
    keyword: targets.filter(r => r.confidence === 'keyword').length,
    unmatched: targets.length - matched,
    applied,
    dryRun,
    rows: targets.slice(0, 100),
  }
}
