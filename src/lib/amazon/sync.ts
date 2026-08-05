import { queryOne, query } from '@/lib/db'
import { fetchAllActiveProducts, fetchProduct } from '@/lib/merchant/product-fetch'
import { productToAmazonListings } from './mapper'
import { putListingsItem, validateListingsItem, deleteListingsItem, AMAZON_PUSH_DISABLED, SELLER_ID } from './client'

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

async function saveSyncStatus(result: Partial<SyncResult> & { status: 'running' | 'success' | 'error'; error?: string }) {
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

// PUT one listing with retry/backoff on HTTP 429 (rate limit).
async function putWithBackoff(sku: string, listing: unknown): Promise<void> {
  let attempt = 0
  for (;;) {
    try {
      await putListingsItem(sku, listing)
      return
    } catch (err: any) {
      const is429 = err?.status === 429
      if (!is429 || attempt >= MAX_RETRIES) throw err
      attempt++
      const retryAfter = Number(err?.retryAfter) || 0
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, waitMs))
    }
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
      synced: 0, deleted: 0,
      errors: [{ sku: '__disabled__', error: 'Amazon push is disabled in this environment' }],
      startedAt: now, finishedAt: now,
    }
  }
  if (!SELLER_ID) {
    const now = new Date().toISOString()
    return {
      synced: 0, deleted: 0,
      errors: [{ sku: '__config__', error: 'AMAZON_SELLER_ID is not set' }],
      startedAt: now, finishedAt: now,
    }
  }
  const lockRes = await queryOne<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired`,
    [SYNC_LOCK_KEY]
  )
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

async function runFullSync(): Promise<SyncResult> {
  const startedAt = new Date().toISOString()
  const errors: Array<{ sku: string; error: string }> = []
  let synced = 0
  const deleted = 0

  const products = await fetchAllActiveProducts()
  const listings: Array<{ sku: string; listing: unknown }> = []

  for (const product of products) {
    try {
      for (const l of productToAmazonListings(product)) {
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
  if (AMAZON_PUSH_DISABLED || !SELLER_ID) return
  const product = await fetchProduct(productId)
  if (!product) return

  const listings = productToAmazonListings(product)
  for (const l of listings) {
    await putWithBackoff(l.sku, l)
  }
}

export async function deleteProductFromAmazon(sku: string): Promise<void> {
  if (AMAZON_PUSH_DISABLED || !SELLER_ID) return
  await deleteListingsItem(sku)
}

// Validate one product's listing(s) against Amazon's productType schema WITHOUT publishing.
// Returns per-SKU issues so we can confirm the mapper before enabling real pushes. This does
// NOT write anything, so it works even with AMAZON_PUSH_DISABLED=true.
export async function validateProductForAmazon(
  productId: string
): Promise<Array<{ sku: string; productType: string; status?: string; issues: any[]; error?: string }>> {
  if (!SELLER_ID) return [{ sku: '__config__', productType: '', issues: [], error: 'AMAZON_SELLER_ID is not set' }]
  const product = await fetchProduct(productId)
  if (!product) return [{ sku: '__notfound__', productType: '', issues: [], error: 'Product not found' }]

  const out: Array<{ sku: string; productType: string; status?: string; issues: any[]; error?: string }> = []
  for (const l of productToAmazonListings(product)) {
    try {
      const res = await validateListingsItem(l.sku, l)
      out.push({ sku: l.sku, productType: l.productType, status: res?.status, issues: res?.issues || [] })
    } catch (err: any) {
      out.push({ sku: l.sku, productType: l.productType, issues: [], error: err.message })
    }
  }
  return out
}

export async function getLastAmazonSyncStatus(): Promise<any> {
  try {
    return await queryOne(
      `SELECT * FROM amazon_sync_log ORDER BY started_at DESC LIMIT 1`,
      []
    )
  } catch (err) {
    return null
  }
}

export async function sendAmazonSyncFailureEmail(result: SyncResult): Promise<void> {
  try {
    const { default: nodemailer } = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 465,
      secure: true,
      auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASSWORD },
    })

    const errorList = result.errors.slice(0, 20).map(e => `<li><strong>${e.sku}</strong>: ${e.error}</li>`).join('')
    const more = result.errors.length > 20 ? `<p>...and ${result.errors.length - 20} more errors.</p>` : ''

    await transporter.sendMail({
      from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `[Alert] Amazon Marketplace Sync — ${result.errors.length} error(s)`,
      html: `
        <h2>Amazon Marketplace Sync Report</h2>
        <p><strong>Started:</strong> ${result.startedAt}</p>
        <p><strong>Finished:</strong> ${result.finishedAt}</p>
        <p><strong>Synced:</strong> ${result.synced} &nbsp; <strong>Errors:</strong> ${result.errors.length}</p>
        <h3>Errors</h3><ul>${errorList}</ul>${more}
      `,
    })
  } catch (_) {}
}
