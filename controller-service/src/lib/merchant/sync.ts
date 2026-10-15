import { queryOne, query, getClient } from '@/lib/shared/db'
import { productToGmcItems, gmcItemProblem } from './mapper'
import { fetchAllActiveProducts, fetchProduct } from './product-fetch'
import {
  upsertProduct,
  deleteProductByOfferId,
  listProducts,
  customBatchUpsert,
  getMerchantId,
  merchantConfigured,
  GMC_PUSH_DISABLED,
} from './client'
import { SYNC_IN_PROGRESS_MESSAGE, groupSyncErrors, countSyncErrorItems, type MerchantSyncError } from './sync-errors'

const ADMIN_EMAIL = 'jeffistoress@jeffistores.in'
const BATCH_SIZE = 100
const SYNC_LOCK_KEY = 84219573
// Consecutive whole-batch failures with the same message before the rest of the run is skipped.
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

async function getExistingGmcOfferIds(): Promise<Set<string>> {
  const offerIds = new Set<string>()
  let pageToken: string | undefined

  do {
    const res = await listProducts(pageToken)
    for (const item of res.resources || []) {
      if (item.offerId) offerIds.add(item.offerId)
    }
    pageToken = res.nextPageToken
  } while (pageToken)

  return offerIds
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

  const merchantId = await getMerchantId()
  const products = await fetchAllActiveProducts()
  const allItems: any[] = []
  const activeOfferIds = new Set<string>()

  for (const product of products) {
    try {
      const items = productToGmcItems(product)
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
    const entries = batch.map((item, idx) => ({
      batchId: i + idx,
      merchantId,
      method: 'insert',
      product: item,
    }))
    try {
      const res = await customBatchUpsert(entries)
      repeatedFailures = 0
      for (const entry of res.entries || []) {
        if (entry.errors?.errors?.length) {
          const item = batch[entry.batchId - i]
          const messages = [...new Set(entry.errors.errors.map((e: any) => e.message).filter(Boolean))]
          errors.push({
            sku: item?.offerId || String(entry.batchId),
            error: messages.join('; ') || 'Rejected by Google',
          })
        } else {
          synced++
        }
      }
    } catch (err: any) {
      const message = err?.message || 'Batch request failed'
      repeatedFailures = message === lastBatchError ? repeatedFailures + 1 : 1
      lastBatchError = message
      errors.push({ sku: `batch-${i}`, error: message, items: batch.length })
    }
  }

  try {
    const existingIds = await getExistingGmcOfferIds()
    for (const offerId of existingIds) {
      if (!activeOfferIds.has(offerId)) {
        try {
          await deleteProductByOfferId(offerId)
          deleted++
        } catch (err: any) {
          errors.push({ sku: offerId, error: err.message })
        }
      }
    }
  } catch (err: any) {
    errors.push({ sku: '__list__', error: err.message })
  }

  const finishedAt = new Date().toISOString()
  const result: SyncResult = { synced, deleted, errors, startedAt, finishedAt }
  await saveSyncStatus({ ...result, status: errors.length ? 'error' : 'success' })
  return result
}

export async function syncProductToMerchant(productId: string): Promise<void> {
  if (GMC_PUSH_DISABLED || !(await merchantConfigured())) return
  const product = await fetchProduct(productId)

  if (!product) return

  // Inactive products stay in the feed as out_of_stock (handled by productToGmcItems),
  // so we upsert them rather than delete.
  const items = productToGmcItems(product)
  for (const item of items) {
    if (gmcItemProblem(item)) continue
    await upsertProduct(item)
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
