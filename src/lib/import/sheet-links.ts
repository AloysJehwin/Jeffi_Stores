import { controlPlanePool } from '@/lib/tenant-registry'
import { query } from '@/lib/db'
import { retireProduct } from '@/lib/product-delete'

export interface SheetOrphan {
  productId: string
  sku: string
  name: string
}

export interface SeenProduct {
  productId: string
  sku: string
}

// Record that a sheet owns each product it touched this sync. Idempotent per (tenant, sheet,
// product): re-syncing refreshes sku/last_synced_at/last_job_id. Only google_sheet imports call this.
export async function upsertSheetLinks(
  tenantId: string,
  spreadsheetId: string,
  jobId: string,
  products: SeenProduct[],
): Promise<void> {
  if (products.length === 0) return
  const pool = controlPlanePool()
  for (const p of products) {
    await pool.query(
      `INSERT INTO sheet_product_links (tenant_id, spreadsheet_id, product_id, sku, last_job_id, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, spreadsheet_id, product_id)
       DO UPDATE SET sku = EXCLUDED.sku, last_job_id = EXCLUDED.last_job_id, last_synced_at = now()`,
      [tenantId, spreadsheetId, p.productId, p.sku, jobId],
    )
  }
}

// Products this sheet owns that were NOT present in the current sync — deletion candidates. Names
// are read from the tenant store DB (links carry only the id) for the approval warning list.
export async function computeOrphans(
  tenantId: string,
  spreadsheetId: string,
  seenSkus: string[],
): Promise<SheetOrphan[]> {
  const pool = controlPlanePool()
  const links = await pool.query<{ product_id: string; sku: string }>(
    `SELECT product_id, sku FROM sheet_product_links WHERE tenant_id = $1 AND spreadsheet_id = $2`,
    [tenantId, spreadsheetId],
  )
  const seen = new Set(seenSkus.map((s) => s.toLowerCase()))
  const missing = links.rows.filter((l) => !seen.has(l.sku.toLowerCase()))
  if (missing.length === 0) return []

  const ids = missing.map((m) => m.product_id)
  const names = await query<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  const nameById = new Map(names.rows.map((r) => [r.id, r.name]))
  // A link whose product no longer exists in the store (already deleted elsewhere) is dropped
  // here — it should not be flagged for deletion, just cleaned from the link table on reconcile.
  return missing
    .filter((m) => nameById.has(m.product_id))
    .map((m) => ({ productId: m.product_id, sku: m.sku, name: nameById.get(m.product_id) as string }))
}

// Apply an approved removal set: retire each product (deactivate if it has order/PO history, else
// hard-delete) and drop its link. Runs in the caller's tenant store-DB context. Returns per-product
// outcomes for the job history.
export async function applyOrphanRemoval(
  tenantId: string,
  spreadsheetId: string,
  products: SheetOrphan[],
): Promise<Array<SheetOrphan & { action: 'deactivated' | 'deleted' }>> {
  const results: Array<SheetOrphan & { action: 'deactivated' | 'deleted' }> = []
  for (const p of products) {
    const action = await retireProduct(p.productId)
    await removeSheetLink(tenantId, spreadsheetId, p.productId)
    results.push({ ...p, action })
  }
  return results
}

// Drop link rows so a set of products stops being flagged next sync (used by both "approve" after
// removal and "keep" — a kept product becomes unmanaged by the sheet).
export async function removeSheetLinks(
  tenantId: string,
  spreadsheetId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return
  const pool = controlPlanePool()
  await pool.query(
    `DELETE FROM sheet_product_links
     WHERE tenant_id = $1 AND spreadsheet_id = $2 AND product_id = ANY($3::uuid[])`,
    [tenantId, spreadsheetId, productIds],
  )
}

async function removeSheetLink(tenantId: string, spreadsheetId: string, productId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `DELETE FROM sheet_product_links WHERE tenant_id = $1 AND spreadsheet_id = $2 AND product_id = $3`,
    [tenantId, spreadsheetId, productId],
  )
}
