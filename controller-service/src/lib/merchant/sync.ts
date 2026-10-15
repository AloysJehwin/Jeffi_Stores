import { queryOne, query, getClient } from '@/lib/shared/db'
import { productToGmcItems, gmcItemProblem } from './mapper'
import { fetchAllActiveProducts, fetchProduct } from './product-fetch'
import {
  insertProductInput,
  deleteProductByOfferId,
  listProducts,
  resolveDataSource,
  merchantConfigured,
  GMC_PUSH_DISABLED,
} from './client'
import { catalogBaseUrl } from '@/lib/shared/customer-links'
import { SYNC_IN_PROGRESS_MESSAGE, groupSyncErrors, countSyncErrorItems, type MerchantSyncError } from './sync-errors'

const ADMIN_EMAIL = 'jeffistoress@jeffistores.in'
// The Merchant API has no custombatch: items go as single inserts, CONCURRENCY at a time, in
// chunks of BATCH_SIZE so a chunk that fails as a whole is reported (and can stop the run) as one.
const BATCH_SIZE = 100
const CONCURRENCY = 5
const SYNC_LOCK_KEY = 84219573
// Consecutive whole-chunk failures with the same message before the rest of the run is skipped.
const MAX_REPEATED_BATCH_FAILURES = 3

export class MerchantSyncInProgressError extends Error {
  constructor() {
    super(SYNC_IN_PROGRESS_MESSAGE)
    this.name = 'MerchantSyncInProgressError'
  }
}

interface SyncResult {
  synced: number
  deleted: number
  errors: MerchantSyncError[]
  startedAt: string
  finishedAt: string
}

// Offer ids Google holds from our API data source (products from other sources are left alone).
async function getExistingGmcOfferIds(dataSource: string): Promise<Set<string>> {
  const offerIds = new Set<string>()
  let pageToken: string | undefined

  do {
    const res = await listProducts(pageToken)
    for (const item of res.products || []) {
      if (item.offerId && (!item.dataSource || item.dataSource === dataSource)) offerIds.add(item.offerId)
    }
    pageToken = res.nextPageToken
  } while (pageToken)

  return offerIds
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function saveSyncStatus(
  result: Partial<SyncResult> & { status: 'running' | 'success' | 'error'; error?: string }
) {
  try {
    await query(
      `INSERT INTO merchant_sync_log (status, synced, deleted, errors, started_at, finished_at)
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

export async function syncAllProductsToMerchant(): Promise<SyncResult> {
  if (GMC_PUSH_DISABLED) {
    const now = new Date().toISOString()
    return {
      synced: 0,
      deleted: 0,
      errors: [{ sku: '__disabled__', error: 'GMC push is disabled in this environment' }],
      startedAt: now,
      finishedAt: now,
    }
  }
  if (!(await merchantConfigured())) {
    const now = new Date().toISOString()
    return {
      synced: 0,
      deleted: 0,
      errors: [{ sku: '__config__', error: 'Google Merchant is not connected' }],
      startedAt: now,
      finishedAt: now,
    }
  }
  // Session-level advisory lock held on one dedicated connection for the whole run: a second
  // request is refused, and a crashed pod drops the connection, which releases the lock.
  const client = await getClient()
  let locked = false
  let unlockFailed = false
  try {
    const lockRes = await client.query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock($1) AS acquired`, [
      SYNC_LOCK_KEY,
    ])
    locked = !!lockRes.rows[0]?.acquired
    if (!locked) throw new MerchantSyncInProgressError()
    return await runFullSync()
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1)`, [SYNC_LOCK_KEY]).catch(() => {
        unlockFailed = true
      })
    }
    // Destroy rather than pool a connection that may still hold the lock.
    client.release(unlockFailed || undefined)
  }
}

export async function isMerchantSyncRunning(): Promise<boolean> {
  try {
    const row = await queryOne<{ running: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND classid = 0 AND objid = $1 AND objsubid = 1
       ) AS running`,
      [SYNC_LOCK_KEY]
    )
    return !!row?.running
  } catch {
    return false
  }
}

async function runFullSync(): Promise<SyncResult> {
  const startedAt = new Date().toISOString()
  const errors: MerchantSyncError[] = []
  let synced = 0
  let deleted = 0

  const finish = async () => {
    const result: SyncResult = { synced, deleted, errors, startedAt, finishedAt: new Date().toISOString() }
    await saveSyncStatus({ ...result, status: errors.length ? 'error' : 'success' })
    return result
  }

  let dataSource: string
  try {
    dataSource = await resolveDataSource()
  } catch (err: any) {
    errors.push({ sku: '__datasource__', error: err?.message || 'Merchant API data source unavailable' })
    return finish()
  }

  const baseUrl = await catalogBaseUrl()
  const products = await fetchAllActiveProducts()
  const allItems: any[] = []
  const activeOfferIds = new Set<string>()

  for (const product of products) {
    try {
      const items = productToGmcItems(product, baseUrl)
      for (const item of items) {
        activeOfferIds.add(item.offerId)
        const problem = gmcItemProblem(item)
        if (problem) errors.push({ sku: item.offerId || product.sku, error: problem })
        else allItems.push(item)
      }
    } catch (err: any) {
      errors.push({ sku: product.sku, error: err.message })
    }
  }

  let lastBatchError = ''
  let repeatedFailures = 0
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE)
    if (repeatedFailures >= MAX_REPEATED_BATCH_FAILURES) {
      errors.push({
        sku: `batch-${i}`,
        error: `Skipped after ${MAX_REPEATED_BATCH_FAILURES} batches failed in a row: ${lastBatchError}`,
        items: allItems.length - i,
      })
      break
    }
    const outcomes = await mapLimit(batch, CONCURRENCY, async item => {
      try {
        await insertProductInput(item, { dataSource })
        return null
      } catch (err: any) {
        return String(err?.message || 'Rejected by Google')
      }
    })
    const failed = outcomes.filter((o): o is string => o !== null)
    synced += batch.length - failed.length
    // A chunk where every insert failed for the same reason (auth, quota, outage) is one entry.
    if (failed.length === batch.length && new Set(failed).size === 1) {
      repeatedFailures = failed[0] === lastBatchError ? repeatedFailures + 1 : 1
      lastBatchError = failed[0]
      errors.push({ sku: `batch-${i}`, error: failed[0], items: batch.length })
      continue
    }
    repeatedFailures = 0
    outcomes.forEach((o, idx) => {
      if (o !== null) errors.push({ sku: batch[idx].offerId, error: o })
    })
  }

  try {
    const existingIds = await getExistingGmcOfferIds(dataSource)
    for (const offerId of existingIds) {
      if (!activeOfferIds.has(offerId)) {
        try {
          await deleteProductByOfferId(offerId, dataSource)
          deleted++
        } catch (err: any) {
          errors.push({ sku: offerId, error: err.message })
        }
      }
    }
  } catch (err: any) {
    errors.push({ sku: '__list__', error: err.message })
  }

  return finish()
}

export async function syncProductToMerchant(productId: string): Promise<void> {
  if (GMC_PUSH_DISABLED || !(await merchantConfigured())) return
  const product = await fetchProduct(productId)

  if (!product) return

  // Inactive products stay in the feed as out_of_stock (handled by productToGmcItems),
  // so we upsert them rather than delete.
  const items = productToGmcItems(product, await catalogBaseUrl())
  for (const item of items) {
    if (gmcItemProblem(item)) continue
    await insertProductInput(item)
  }
}

export async function getLastSyncStatus(): Promise<any> {
  try {
    return await queryOne(`SELECT * FROM merchant_sync_log ORDER BY started_at DESC LIMIT 1`, [])
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}

export async function sendSyncFailureEmail(result: SyncResult): Promise<void> {
  try {
    const { sendOperationalReport } = await import('../email')
    await sendOperationalReport({
      title: 'Google Merchant Sync',
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      stats: { Synced: result.synced, Deleted: result.deleted, Errors: countSyncErrorItems(result.errors) },
      errors: groupSyncErrors(result.errors, 10).map(g => ({
        sku: `${g.count} item(s): ${g.skus.join(', ')}`,
        error: g.reason,
      })),
      kind: 'merchant_sync_report',
    })
  } catch (err) {
    console.error('[route]', err)
  }
}
