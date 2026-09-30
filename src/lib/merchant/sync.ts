import { queryOne, query } from '@/lib/db'
import { productToGmcItems } from './mapper'
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

const ADMIN_EMAIL = 'jeffistoress@jeffistores.in'
const BATCH_SIZE = 100
const SYNC_LOCK_KEY = 84219573

interface SyncResult {
  synced: number
  deleted: number
  errors: Array<{ sku: string; error: string }>
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

async function runFullSync(): Promise<SyncResult> {
  const startedAt = new Date().toISOString()
  const errors: Array<{ sku: string; error: string }> = []
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
        allItems.push(item)
        activeOfferIds.add(item.offerId)
      }
    } catch (err: any) {
      errors.push({ sku: product.sku, error: err.message })
    }
  }

  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE)
    const entries = batch.map((item, idx) => ({
      batchId: i + idx,
      merchantId,
      method: 'insert',
      product: item,
    }))
    try {
      const res = await customBatchUpsert(entries)
      for (const entry of res.entries || []) {
        if (entry.errors?.errors?.length) {
          const item = batch[entry.batchId - i]
          errors.push({ sku: item?.offerId || String(entry.batchId), error: entry.errors.errors[0].message })
        } else {
          synced++
        }
      }
    } catch (err: any) {
      errors.push({ sku: `batch-${i}`, error: err.message })
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
      stats: { Synced: result.synced, Deleted: result.deleted, Errors: result.errors.length },
      errors: result.errors,
      kind: 'merchant_sync_report',
    })
  } catch (err) {
    console.error('[route]', err)
  }
}
