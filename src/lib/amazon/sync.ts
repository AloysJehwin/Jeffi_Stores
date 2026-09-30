import { queryOne, query } from '@/lib/shared/db'
import { fetchAllActiveProducts, fetchProduct } from '@/lib/merchant/product-fetch'
import { productToAmazonListings, productToAmazonOfferListing, type AmazonListing } from './mapper'
import {
  putListingsItem,
  patchListingsItem,
  validateListingsItem,
  deleteListingsItem,
  matchAsin,
  AMAZON_PUSH_DISABLED,
  amazonConfigured,
  getMarketplaceId,
} from './client'
import { getBusinessValues } from '@/lib/catalog/site-controls'

// Amazon catalog push — analog of src/lib/merchant/sync.ts (Google).
// Unlike GMC (which has a /products/batch), SP-API Listings Items is one PUT per SKU, so we
// push with a bounded concurrency pool + 429 backoff. Distinct advisory lock from GMC.
const ADMIN_EMAIL = 'jeffistoress@jeffistores.in'
const CONCURRENCY = 5
const SYNC_LOCK_KEY = 84219575
const MAX_RETRIES = 3

interface SyncResult {
  synced: number
  deleted: number
  errors: Array<{ sku: string; error: string }>
  startedAt: string
  finishedAt: string
}

async function saveSyncStatus(
  result: Partial<SyncResult> & { status: 'running' | 'success' | 'error'; error?: string }
) {
  try {
    await query(
      `INSERT INTO amazon_sync_log (status, synced, deleted, errors, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        result.status,
        result.synced ?? 0,
        result.deleted ?? 0,
        result.errors ? JSON.stringify(result.errors) : null,
        result.startedAt ?? new Date().toISOString(),
        result.finishedAt ?? null,
      ]
    )
  } catch (_) {}
}

// PUT one listing with retry/backoff on HTTP 429 (rate limit). For offer-only listings, follow
// with a targeted PATCH of purchasable_offer — a bundled offer-only PUT silently drops the offer
// (listing stays DISCOVERABLE-not-BUYABLE), so the offer must be patched in separately.
async function putWithBackoff(sku: string, listing: any): Promise<void> {
  let attempt = 0
  for (;;) {
    try {
      await putListingsItem(sku, listing)
      break
    } catch (err: any) {
      const is429 = err?.status === 429
      if (!is429 || attempt >= MAX_RETRIES) throw err
      attempt++
      const retryAfter = Number(err?.retryAfter) || 0
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, waitMs))
    }
  }

  const offer = listing?.attributes?.purchasable_offer
  if (listing?.requirements === 'LISTING_OFFER_ONLY' && offer) {
    try {
      await patchListingsItem(sku, listing.productType, [
        { op: 'replace', path: '/attributes/purchasable_offer', value: offer },
      ])
    } catch {
      /* offer patch failure is surfaced by the later status refresh */
    }
  }

  // Store-on-push: persist the ASIN this SKU is now listed against (highest confidence).
  const asin = (listing?.attributes?.merchant_suggested_asin as any)?.[0]?.value
  if (asin) await persistListedAsin(sku, String(asin)).catch(() => {})
}

// Write the confirmed ASIN back onto the variant (or simple product) matched by SKU.
async function persistListedAsin(sku: string, asin: string): Promise<void> {
  const upd = await query(`UPDATE product_variants SET asin = $1, asin_match = 'listed' WHERE sku = $2`, [asin, sku])
  // If no variant matched this SKU, try the product-level (simple product) SKU.
  if (!(upd as any)?.rowCount) {
    await query(`UPDATE products SET asin = $1, asin_match = 'listed' WHERE sku = $2`, [asin, sku])
  }
}

// Run tasks through a fixed-size worker pool (SP-API Listings PUT ~5 rps).
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx])
    }
  })
  await Promise.all(workers)
}

export async function syncAllProductsToAmazon(): Promise<SyncResult> {
  if (AMAZON_PUSH_DISABLED) {
    const now = new Date().toISOString()
    return {
      synced: 0,
      deleted: 0,
      errors: [{ sku: '__disabled__', error: 'Amazon push is disabled in this environment' }],
      startedAt: now,
      finishedAt: now,
    }
  }
  if (!(await amazonConfigured())) {
    const now = new Date().toISOString()
    return {
      synced: 0,
      deleted: 0,
      errors: [{ sku: '__config__', error: 'Amazon is not connected' }],
      startedAt: now,
      finishedAt: now,
    }
  }
  const lockRes = await queryOne<{ acquired: boolean }>(`SELECT pg_try_advisory_lock($1) AS acquired`, [SYNC_LOCK_KEY])
  if (!lockRes?.acquired) {
    const startedAt = new Date().toISOString()
    return {
      synced: 0,
      deleted: 0,
      errors: [{ sku: '__lock__', error: 'Another sync is already running' }],
      startedAt,
      finishedAt: startedAt,
    }
  }

  try {
    return await runFullSync()
  } finally {
    await query(`SELECT pg_advisory_unlock($1)`, [SYNC_LOCK_KEY]).catch(() => {})
  }
}

// Match an ASIN, swallowing catalog API errors (rate limits, transient) so a failed lookup
// degrades to full-create rather than crashing the whole product.
async function safeMatchAsin(input: Parameters<typeof matchAsin>[0]) {
  try {
    return await matchAsin(input)
  } catch {
    return null
  }
}

// Decide the listing strategy for ONE product:
//   ASIN match  -> offer-only listing(s) (bypasses the brand-creation gate; authorized reseller)
//   no match    -> full-create listing(s) (only succeeds for non-brand-gated brands)
// Emits one offer-only listing per matched priced variant; if no variant matches, falls back to
// full-create for the whole product.
// A stored ASIN is trusted (skip the catalog search) when it came from a GTIN match or a real
// listing — not a fuzzy keyword guess.
function trustedAsin(row: any): string | null {
  return row?.asin && (row.asin_match === 'gtin' || row.asin_match === 'listed') ? row.asin : null
}

async function resolveListingsForProduct(product: any): Promise<AmazonListing[]> {
  const brand = product.brands?.name || ''
  const marketplaceId = await getMarketplaceId()
  const bv = await getBusinessValues()
  const contactText = `${bv.sellerName}, ${bv.sellerAddress}. Phone: ${bv.sellerPhone}`
  const hasVariants = product.has_variants && product.product_variants?.length > 0

  if (hasVariants) {
    const out: AmazonListing[] = []
    for (const v of product.product_variants) {
      if (v.price == null) continue
      const stored = trustedAsin(v)
      const asin =
        stored ||
        (
          await safeMatchAsin({
            gtin: v.gtin || product.gtin,
            brand,
            mpn: v.mpn || product.mpn,
            name: `${brand} ${product.name} ${v.variant_name || ''}`.trim(),
          })
        )?.asin
      if (asin) out.push(productToAmazonOfferListing(product, asin, marketplaceId, v))
    }
    if (out.length) return out
    return productToAmazonListings(product, marketplaceId, contactText)
  }

  const stored = trustedAsin(product)
  const asin =
    stored ||
    (
      await safeMatchAsin({
        gtin: product.gtin,
        brand,
        mpn: product.mpn,
        name: `${brand} ${product.name}`.trim(),
      })
    )?.asin
  if (asin) return [productToAmazonOfferListing(product, asin, marketplaceId)]
  return productToAmazonListings(product, marketplaceId, contactText)
}

async function runFullSync(): Promise<SyncResult> {
  const startedAt = new Date().toISOString()
  const errors: Array<{ sku: string; error: string }> = []
  let synced = 0
  const deleted = 0

  const products = await fetchAllActiveProducts()
  const listings: Array<{ sku: string; listing: unknown }> = []

  for (const product of products) {
    try {
      for (const l of await resolveListingsForProduct(product)) {
        listings.push({ sku: l.sku, listing: l })
      }
    } catch (err: any) {
      errors.push({ sku: product.sku, error: err.message })
    }
  }

  await runPool(listings, async ({ sku, listing }) => {
    try {
      await putWithBackoff(sku, listing)
      synced++
    } catch (err: any) {
      errors.push({ sku, error: err.message })
    }
  })

  const finishedAt = new Date().toISOString()
  const result: SyncResult = { synced, deleted, errors, startedAt, finishedAt }
  await saveSyncStatus({ ...result, status: errors.length ? 'error' : 'success' })
  return result
}

export async function syncProductToAmazon(productId: string): Promise<void> {
  if (AMAZON_PUSH_DISABLED || !(await amazonConfigured())) return
  const product = await fetchProduct(productId)
  if (!product) return

  const listings = await resolveListingsForProduct(product)
  for (const l of listings) {
    await putWithBackoff(l.sku, l)
  }
}

export async function deleteProductFromAmazon(sku: string): Promise<void> {
  if (AMAZON_PUSH_DISABLED || !(await amazonConfigured())) return
  await deleteListingsItem(sku)
}

// Validate one product's listing(s) against Amazon's productType schema WITHOUT publishing.
// Returns per-SKU issues so we can confirm the mapper before enabling real pushes. This does
// NOT write anything, so it works even with AMAZON_PUSH_DISABLED=true.
export async function validateProductForAmazon(
  productId: string
): Promise<
  Array<{ sku: string; productType: string; requirements?: string; status?: string; issues: any[]; error?: string }>
> {
  if (!(await amazonConfigured()))
    return [{ sku: '__config__', productType: '', issues: [], error: 'Amazon is not connected' }]
  const product = await fetchProduct(productId)
  if (!product) return [{ sku: '__notfound__', productType: '', issues: [], error: 'Product not found' }]

  const out: Array<{
    sku: string
    productType: string
    requirements: string
    status?: string
    issues: any[]
    error?: string
  }> = []
  for (const l of await resolveListingsForProduct(product)) {
    try {
      const res = await validateListingsItem(l.sku, l)
      out.push({
        sku: l.sku,
        productType: l.productType,
        requirements: l.requirements,
        status: res?.status,
        issues: res?.issues || [],
      })
    } catch (err: any) {
      out.push({ sku: l.sku, productType: l.productType, requirements: l.requirements, issues: [], error: err.message })
    }
  }
  return out
}

export interface AmazonDryRunRow {
  productId: string
  sku: string
  name: string
  brand: string
  strategy: 'offer-only' | 'create'
  asin: string | null
  listable: boolean | null
  postable: boolean | null // VALIDATION_PREVIEW passed (would actually post)
  blockReason?: string // top issue code/message if not postable
}

export interface AmazonDryRunReport {
  scanned: number
  offerOnly: number
  create: number
  postable: number
  blocked: number
  rows: AmazonDryRunRow[]
  truncated: boolean
}

// DRY RUN: for up to `limit` active products, report whether each matches an existing ASIN
// (=> offer-only) or would be full-create, whether the matched ASIN is listable, and whether an
// offer VALIDATION_PREVIEW actually passes (postable). Writes NOTHING to Amazon.
export async function dryRunAmazonSync(limit = 100): Promise<AmazonDryRunReport> {
  const products = await fetchAllActiveProducts()
  const slice = products.slice(0, limit)
  const rows: AmazonDryRunRow[] = []

  for (const product of slice) {
    try {
      const listings = await resolveListingsForProduct(product)
      const l = listings[0]
      const isOffer = l?.requirements === 'LISTING_OFFER_ONLY'
      const asin = isOffer ? ((l.attributes as any)?.merchant_suggested_asin?.[0]?.value ?? null) : null

      let postable: boolean | null = null
      let blockReason: string | undefined
      if (l) {
        try {
          const res = await validateListingsItem(l.sku, l)
          postable = res?.status === 'VALID'
          if (!postable) {
            const iss = (res?.issues || [])[0]
            blockReason = iss ? `${iss.code || ''}: ${String(iss.message || '').slice(0, 80)}` : 'invalid'
          }
        } catch (err: any) {
          postable = null
          blockReason = err.message?.slice(0, 80)
        }
      }

      rows.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brands?.name || '',
        strategy: isOffer ? 'offer-only' : 'create',
        asin,
        listable: isOffer ? true : null,
        postable,
        blockReason,
      })
    } catch (err: any) {
      rows.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brands?.name || '',
        strategy: 'create',
        asin: null,
        listable: null,
        postable: null,
        blockReason: err.message?.slice(0, 80),
      })
    }
  }

  const offerOnly = rows.filter(r => r.strategy === 'offer-only').length
  return {
    scanned: rows.length,
    offerOnly,
    create: rows.length - offerOnly,
    postable: rows.filter(r => r.postable === true).length,
    blocked: rows.filter(r => r.postable === false).length,
    rows,
    truncated: products.length > slice.length,
  }
}

export async function getLastAmazonSyncStatus(): Promise<any> {
  try {
    return await queryOne(`SELECT * FROM amazon_sync_log ORDER BY started_at DESC LIMIT 1`, [])
  } catch (err) {
    return null
  }
}

export async function sendAmazonSyncFailureEmail(result: SyncResult): Promise<void> {
  try {
    // A service should describe what happened; the email service renders and audits it. This
    // built its own SES transport and sent bare <h2>/<ul> HTML, so it looked nothing like the
    // rest of the system's mail and never appeared in /admin/audit?tab=mail_log.
    const { sendOperationalReport } = await import('../email')
    await sendOperationalReport({
      title: 'Amazon Marketplace Sync',
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      stats: { Synced: result.synced, Errors: result.errors.length },
      errors: result.errors,
      kind: 'amazon_sync_report',
    })
  } catch (_) {}
}
