import { query, queryOne, queryMany, getClient } from './db'
import { PoolClient } from 'pg'
import { buildProductSearchClause, buildProductSearchRank, buildSearchClause } from './search'
import { round2 } from './gst'

export type TransactionType = 'purchase' | 'sale' | 'return' | 'adjustment'
export type ReferenceType = 'order' | 'grn' | 'manual' | 'cash_sale'

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock'

// Map an on-hand quantity to a stock_status. Used only when a product's
// inventory_sync flag is ON. threshold null/undefined → binary In/Out (no Low
// Stock band); otherwise 0<qty<=threshold → Low Stock.
export function deriveStockStatus(qty: number, threshold?: number | null): StockStatus {
  if (!(qty > 0)) return 'Out of Stock'
  if (threshold != null && qty <= threshold) return 'Low Stock'
  return 'In Stock'
}

// Read a product's inventory-sync config once per operation. Callers gate their
// stock_status recompute on `enabled`.
export async function getInventorySync(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> } | null,
  productId: string
): Promise<{ enabled: boolean; threshold: number | null }> {
  const run = client
    ? (sql: string, params: any[]) => client.query(sql, params)
    : (sql: string, params: any[]) => query(sql, params)
  const res = await run(
    `SELECT inventory_sync, low_stock_threshold FROM products WHERE id = $1`,
    [productId]
  )
  const row = res.rows[0]
  return {
    enabled: !!row?.inventory_sync,
    threshold: row?.low_stock_threshold != null ? parseFloat(row.low_stock_threshold) : null,
  }
}

// When inventory_sync is ON, recompute stock_status from the CURRENT
// inventory_quantity for the product, its active variants, and their active
// sub-variants. No-op when the flag is OFF (manual status is preserved). Callers
// invoke this after any inventory_quantity mutation on paths that don't already
// flow through syncCentralInventory (sales, order restore, PO direct bumps).
export async function recomputeStockStatusForProduct(
  client: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> } | null,
  productId: string
): Promise<void> {
  const run = client
    ? (sql: string, params: any[]) => client.query(sql, params)
    : (sql: string, params: any[]) => query(sql, params)
  const { enabled, threshold } = await getInventorySync(client, productId)
  if (!enabled) return
  // Derive in SQL to keep it one round-trip per grain. Mirror deriveStockStatus:
  //   qty<=0 → Out of Stock; threshold set & qty<=threshold → Low Stock; else In Stock.
  // Parent grains derive from the ROLLED-UP quantity (variant = SUM active subs when
  // any exist, product = SUM active variants) so status matches the effective stock
  // even on paths (e.g. a leaf-only sale deduct) that didn't cascade quantities.
  const statusExpr = (qtyExpr: string) => `
    CASE WHEN COALESCE(${qtyExpr},0) <= 0 THEN 'Out of Stock'
         WHEN $2::numeric IS NOT NULL AND COALESCE(${qtyExpr},0) <= $2::numeric THEN 'Low Stock'
         ELSE 'In Stock' END`
  // Sub-variants: from their own inventory_quantity (leaf).
  await run(
    `UPDATE product_sub_variants sv SET stock_status = ${statusExpr('sv.inventory_quantity')}, updated_at = now()
     WHERE sv.variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
    [productId, threshold]
  )
  // Variants: from SUM(active sub-variants) when any exist, else own inventory_quantity.
  await run(
    `UPDATE product_variants pv SET stock_status = ${statusExpr(
      `CASE WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            THEN (SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            ELSE pv.inventory_quantity END`
    )}, updated_at = now()
     WHERE pv.product_id = $1`,
    [productId, threshold]
  )
  // Product: from SUM(active variants) when any exist, else own inventory_quantity.
  await run(
    `UPDATE products p SET stock_status = ${statusExpr(
      `CASE WHEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true)
            THEN (SELECT SUM(v.inventory_quantity) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true)
            ELSE p.inventory_quantity END`
    )}, updated_at = now()
     WHERE p.id = $1`,
    [productId, threshold]
  )
}


export async function logStockMovement(
  client: PoolClient | null,
  params: {
    productId: string
    variantId: string | null
    subVariantId?: string | null
    transactionType: TransactionType
    quantityChange: number
    referenceType: ReferenceType
    referenceId: string
    notes?: string
    currentStock?: number
    unitId?: string | null
    unitLabel?: string | null
    unitFactor?: number | null
    quantityInUnit?: number | null
    batchId?: string | null
    lotNumber?: string | null
    expiryDate?: string | null
    serialNumber?: string | null
  }
) {
  const { productId, variantId, subVariantId, transactionType, quantityChange, referenceType, referenceId, notes } = params

  let currentStockRaw: number
  if (params.currentStock !== undefined) {
    currentStockRaw = params.currentStock
  } else if (subVariantId) {
    const row = await queryOne<{ inventory_quantity: number }>(
      'SELECT inventory_quantity FROM product_sub_variants WHERE id = $1', [subVariantId])
    currentStockRaw = parseFloat(row?.inventory_quantity as any) || 0
  } else if (variantId) {
    const row = await queryOne<{ inventory_quantity: number }>(
      'SELECT inventory_quantity FROM product_variants WHERE id = $1', [variantId])
    currentStockRaw = parseFloat(row?.inventory_quantity as any) || 0
  } else {
    const row = await queryOne<{ inventory_quantity: number }>(
      'SELECT inventory_quantity FROM products WHERE id = $1', [productId])
    currentStockRaw = parseFloat(row?.inventory_quantity as any) || 0
  }

  const qtyChange = quantityChange
  const quantityAfter = Math.round((currentStockRaw + quantityChange) * 1000) / 1000

  const sql = `INSERT INTO inventory_transactions
    (product_id, variant_id, sub_variant_id, transaction_type, quantity_change, quantity_after,
     reference_type, reference_id, notes, unit_id, unit_label, unit_factor, quantity_in_unit, batch_id,
     lot_number, expiry_date, serial_number)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`
  const values = [
    productId, variantId, subVariantId || null,
    transactionType, qtyChange, quantityAfter,
    referenceType, referenceId, notes || null,
    params.unitId || null, params.unitLabel || null,
    params.unitFactor || null, params.quantityInUnit || null,
    params.batchId || null,
    params.lotNumber || null, params.expiryDate || null, params.serialNumber || null,
  ]

  if (client) {
    await client.query(sql, values)
  } else {
    await query(sql, values)
  }
}

export async function updateWeightedAvgCost(
  client: PoolClient,
  params: {
    productId: string
    variantId: string | null
    subVariantId?: string | null
    qtyReceived: number
    unitCost: number
  }
) {
  const { productId, variantId, subVariantId, qtyReceived, unitCost } = params

  if (subVariantId) {
    // Sub-variants have no cost_price column of their own — cost is tracked at the
    // product/variant level. Skip the WAC write here rather than corrupting the
    // main product's cost (the previous behaviour). Stock qty is handled by the caller.
    return
  } else if (variantId) {
    const row = await client.query<{ inventory_quantity: number; cost_price: number }>(
      'SELECT inventory_quantity, cost_price FROM product_variants WHERE id = $1 FOR UPDATE', [variantId])
    const cur = row.rows[0]
    const curStock = parseFloat(cur?.inventory_quantity as any) || 0
    const curCost = parseFloat(cur?.cost_price as any) || 0
    const newCost = curStock + qtyReceived > 0
      ? (curStock * curCost + qtyReceived * unitCost) / (curStock + qtyReceived)
      : unitCost
    await client.query(
      'UPDATE product_variants SET cost_price = $1 WHERE id = $2',
      [round2(newCost), variantId]
    )
  } else {
    const row = await client.query<{ inventory_quantity: number; cost_price: number }>(
      'SELECT inventory_quantity, cost_price FROM products WHERE id = $1 FOR UPDATE', [productId])
    const cur = row.rows[0]
    const curStock = parseFloat(cur?.inventory_quantity as any) || 0
    const curCost = parseFloat(cur?.cost_price as any) || 0
    const newCost = curStock + qtyReceived > 0
      ? (curStock * curCost + qtyReceived * unitCost) / (curStock + qtyReceived)
      : unitCost
    await client.query(
      'UPDATE products SET cost_price = $1 WHERE id = $2',
      [round2(newCost), productId]
    )
  }
}

export async function getStockLedger(filters: {
  productId?: string
  search?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}) {
  const conditions: string[] = ['1=1']
  const params: any[] = []
  let i = 1

  if (filters.productId) { conditions.push(`it.product_id = $${i++}`); params.push(filters.productId) }
  if (filters.from) { conditions.push(`it.created_at >= $${i++}`); params.push(filters.from) }
  if (filters.to) { conditions.push(`it.created_at <= $${i++}`); params.push(filters.to + ' 23:59:59') }
  if (filters.search) {
    const sc = buildProductSearchClause(filters.search, 'p.name', 'p.sku', 'p.search_vector', i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.join(' AND ')

  // Ledger rows are grouped in the UI by (reference_id, transaction_type) — a
  // GRN/sale that touched 50 serials is ONE event. Paginate by that group so the
  // footer counts events (not raw rows) and no group splits across a page.
  // Group key must match the UI (InventoryClient ledgerGroups): reference_id +
  // transaction_type, falling back to the row id for legacy rows with no reference.
  const GROUP_KEY = `COALESCE(it.reference_id::text || '::' || it.transaction_type, it.id::text)`

  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(DISTINCT ${GROUP_KEY})::int AS total
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     LEFT JOIN product_variants pv ON pv.id = it.variant_id
     WHERE ${where}`,
    params
  )
  const total = countRow?.total || 0

  const limit = filters.limit || 50
  const offset = filters.offset || 0

  // Step 1: the page's group keys, ordered by event recency.
  const pageParams = [...params, limit, offset]
  const groupRows = await queryMany<{ group_key: string }>(
    `SELECT ${GROUP_KEY} AS group_key, MAX(it.created_at) AS ts
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     LEFT JOIN product_variants pv ON pv.id = it.variant_id
     WHERE ${where}
     GROUP BY group_key
     ORDER BY ts DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    pageParams
  )

  if (!groupRows || groupRows.length === 0) return { rows: [], total }

  // Step 2: all child rows for exactly those groups, kept contiguous and in the
  // same group order (by the group's newest timestamp) so the UI groups cleanly.
  const keys = groupRows.map(g => g.group_key)
  const rowParams = [...params, keys]
  const rows = await queryMany<any>(`
    SELECT
      it.id,
      it.created_at,
      it.transaction_type,
      it.quantity_change,
      it.quantity_after,
      it.reference_type,
      it.reference_id,
      it.notes,
      it.unit_id,
      it.unit_label,
      it.unit_factor,
      it.quantity_in_unit,
      it.batch_id,
      COALESCE(it.lot_number, pb.lot_number) AS lot_number,
      COALESCE(it.expiry_date, pb.expiry_date) AS expiry_date,
      it.serial_number,
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(sv.sku, pv.sku, p.sku) AS product_sku,
      p.cost_price AS product_cost_price,
      pv.id AS variant_id,
      pv.variant_name,
      pv.cost_price AS variant_cost_price,
      sv.id AS sub_variant_id,
      sv.sub_variant_name,
      CASE
        WHEN it.reference_type = 'order'     THEN o.invoice_number
        WHEN it.reference_type = 'cash_sale' THEN cs.invoice_number
        WHEN it.reference_type = 'grn'       THEN g.grn_number
        ELSE NULL
      END AS reference_label
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    LEFT JOIN product_variants pv ON pv.id = it.variant_id
    LEFT JOIN product_sub_variants sv ON sv.id = it.sub_variant_id
    LEFT JOIN product_batches pb ON pb.id = it.batch_id
    LEFT JOIN orders o  ON it.reference_type = 'order'     AND o.id  = it.reference_id
    LEFT JOIN cash_sales cs ON it.reference_type = 'cash_sale' AND cs.id = it.reference_id
    LEFT JOIN grns g    ON it.reference_type = 'grn'       AND g.id  = it.reference_id
    WHERE ${where} AND ${GROUP_KEY} = ANY($${i}::text[])
    ORDER BY MAX(it.created_at) OVER (PARTITION BY ${GROUP_KEY}) DESC, ${GROUP_KEY}, it.created_at DESC
  `, rowParams)

  return { rows: rows || [], total }
}

export async function getStockValuation(filters: {
  limit?: number
  offset?: number
  search?: string
  categoryName?: string
  brandName?: string
  stockStatus?: string
  sort?: string
  dir?: string
} = {}) {
  const { limit = 50, offset = 0, search, categoryName, brandName, stockStatus, sort, dir } = filters

  // Build WHERE conditions applied to each UNION leg via a wrapping CTE
  const havingClauses: string[] = []
  const params: any[] = []
  let i = 1

  const baseQuery = `
    WITH rows AS (
      SELECT
        p.id, p.name, p.sku, p.sku AS row_sku,
        p.search_vector AS search_vector,
        COALESCE(p.inventory_quantity, 0) AS inventory_quantity,
        COALESCE(p.gst_percentage, 0) AS gst_percentage,
        COALESCE(p.base_price, 0) AS selling_price,
        ROUND(COALESCE(p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS cost_price,
        COALESCE(p.inventory_quantity, 0) * ROUND(COALESCE(p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS stock_value,
        NULL::uuid AS variant_id,
        NULL AS variant_name,
        NULL::uuid AS sub_variant_id,
        NULL AS sub_variant_name,
        FALSE AS has_variants,
        p.category_id,
        c.name AS category_name,
        b.name AS brand_name,
        su.unit AS sell_unit,
        su.display_label AS sell_unit_label,
        su.dimension AS sell_unit_dimension,
        su.factor AS sell_unit_factor,
        bu.display_label AS base_unit_label,
        p.perishable,
        p.serialized,
        (SELECT COALESCE(SUM(pb2.quantity_remaining), 0) FROM product_batches pb2
         WHERE pb2.product_id = p.id AND pb2.variant_id IS NULL AND pb2.sub_variant_id IS NULL
           AND pb2.quantity_remaining > 0) AS batch_qty_total
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT unit, display_label, dimension, factor FROM product_units
        WHERE product_id = p.id AND variant_id IS NULL AND sub_variant_id IS NULL
        ORDER BY is_base DESC LIMIT 1
      ) su ON TRUE
      LEFT JOIN LATERAL (
        SELECT display_label FROM product_units
        WHERE product_id = p.id AND variant_id IS NULL AND sub_variant_id IS NULL AND is_base = TRUE
        LIMIT 1
      ) bu ON TRUE
      WHERE p.has_variants = FALSE AND p.is_active = TRUE
      UNION ALL
      SELECT
        p.id, p.name, p.sku, pv.sku AS row_sku,
        p.search_vector AS search_vector,
        COALESCE(pv.inventory_quantity, 0) AS inventory_quantity,
        COALESCE(p.gst_percentage, 0) AS gst_percentage,
        COALESCE(pv.price, p.base_price, 0) AS selling_price,
        ROUND(COALESCE(pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS cost_price,
        COALESCE(pv.inventory_quantity, 0) * ROUND(COALESCE(pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS stock_value,
        pv.id AS variant_id,
        pv.variant_name,
        NULL::uuid AS sub_variant_id,
        NULL AS sub_variant_name,
        TRUE AS has_variants,
        p.category_id,
        c.name AS category_name,
        b.name AS brand_name,
        su.unit AS sell_unit,
        su.display_label AS sell_unit_label,
        su.dimension AS sell_unit_dimension,
        su.factor AS sell_unit_factor,
        bu.display_label AS base_unit_label,
        p.perishable,
        p.serialized,
        (SELECT COALESCE(SUM(pb2.quantity_remaining), 0) FROM product_batches pb2
         WHERE pb2.product_id = p.id AND pb2.variant_id = pv.id AND pb2.sub_variant_id IS NULL
           AND pb2.quantity_remaining > 0) AS batch_qty_total
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT unit, display_label, dimension, factor FROM product_units
        WHERE product_id = p.id AND variant_id = pv.id AND sub_variant_id IS NULL
        ORDER BY is_base DESC LIMIT 1
      ) su ON TRUE
      LEFT JOIN LATERAL (
        SELECT display_label FROM product_units
        WHERE product_id = p.id AND variant_id = pv.id AND sub_variant_id IS NULL AND is_base = TRUE
        LIMIT 1
      ) bu ON TRUE
      WHERE p.is_active = TRUE AND pv.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = TRUE)
      UNION ALL
      SELECT
        p.id, p.name, p.sku, sv.sku AS row_sku,
        p.search_vector AS search_vector,
        COALESCE(sv.inventory_quantity, 0) AS inventory_quantity,
        COALESCE(p.gst_percentage, 0) AS gst_percentage,
        COALESCE(sv.price, pv.price, p.base_price, 0) AS selling_price,
        ROUND(COALESCE(sv.price, pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS cost_price,
        COALESCE(sv.inventory_quantity, 0) * ROUND(COALESCE(sv.price, pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2) AS stock_value,
        pv.id AS variant_id,
        pv.variant_name,
        sv.id AS sub_variant_id,
        sv.sub_variant_name,
        TRUE AS has_variants,
        p.category_id,
        c.name AS category_name,
        b.name AS brand_name,
        su.unit AS sell_unit,
        su.display_label AS sell_unit_label,
        su.dimension AS sell_unit_dimension,
        su.factor AS sell_unit_factor,
        bu.display_label AS base_unit_label,
        p.perishable,
        p.serialized,
        (SELECT COALESCE(SUM(pb2.quantity_remaining), 0) FROM product_batches pb2
         WHERE pb2.product_id = p.id AND pb2.variant_id = pv.id AND pb2.sub_variant_id = sv.id
           AND pb2.quantity_remaining > 0) AS batch_qty_total
      FROM product_sub_variants sv
      JOIN product_variants pv ON pv.id = sv.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT unit, display_label, dimension, factor FROM (
          SELECT unit, display_label, dimension, factor, 1 AS tier FROM product_units
          WHERE product_id = p.id AND sub_variant_id = sv.id
          ORDER BY is_base DESC LIMIT 1
        ) t1
        UNION ALL
        SELECT unit, display_label, dimension, factor FROM (
          SELECT unit, display_label, dimension, factor FROM product_units
          WHERE product_id = p.id AND variant_id = pv.id AND sub_variant_id IS NULL
          ORDER BY is_base DESC LIMIT 1
        ) t2
        UNION ALL
        SELECT unit, display_label, dimension, factor FROM (
          SELECT unit, display_label, dimension, factor FROM product_units
          WHERE product_id = p.id AND variant_id IS NULL AND sub_variant_id IS NULL
          ORDER BY is_base DESC LIMIT 1
        ) t3
        LIMIT 1
      ) su ON TRUE
      LEFT JOIN LATERAL (
        SELECT display_label FROM (
          SELECT display_label FROM product_units
          WHERE product_id = p.id AND sub_variant_id = sv.id AND is_base = TRUE LIMIT 1
        ) b1
        UNION ALL
        SELECT display_label FROM (
          SELECT display_label FROM product_units
          WHERE product_id = p.id AND variant_id = pv.id AND sub_variant_id IS NULL AND is_base = TRUE LIMIT 1
        ) b2
        UNION ALL
        SELECT display_label FROM (
          SELECT display_label FROM product_units
          WHERE product_id = p.id AND variant_id IS NULL AND sub_variant_id IS NULL AND is_base = TRUE LIMIT 1
        ) b3
        LIMIT 1
      ) bu ON TRUE
      WHERE p.is_active = TRUE AND pv.is_active = TRUE AND sv.is_active = TRUE
    )
  `

  if (search) {
    // Product-name search for valuation. Strategy (tuned for precision):
    //   1. STRICT: every typed word must appear (substring) somewhere in the row's
    //      name / sku / variant / sub-variant. "Taparia 1/4 Square Drive Sockets"
    //      then matches only the handful of products that contain ALL those words —
    //      not the hundreds that merely share "Square"/"Drive"/"Sockets".
    //   2. FUZZY FALLBACK: only when the strict clause finds almost nothing (< 3
    //      products, e.g. because of a typo) do we widen to buildProductSearchClause's
    //      full-text + trigram matching, so a mistyped query still returns something.
    const words = search.trim().split(/\s+/).map(w => w.replace(/^[^\w/]+|[^\w/]+$/g, '')).filter(Boolean)
    const cols = ['rows.name', 'rows.row_sku', 'rows.variant_name', 'rows.sub_variant_name']

    // Strict clause with its own 1-based params for the pre-flight count.
    const strictParams: any[] = []
    let si = 1
    const strictPerCol = cols.map(col => {
      const wordClauses = words.map(w => { strictParams.push(`%${w}%`); return `${col} ILIKE $${si++}` })
      return `(${wordClauses.join(' AND ')})`
    })
    const strictClause = `(${strictPerCol.join(' OR ')})`

    const strictCount = words.length === 0 ? 0 : await queryOne<{ n: number }>(
      `${baseQuery} SELECT COUNT(DISTINCT rows.id)::int AS n FROM rows WHERE ${strictClause}`,
      strictParams
    ).then(r => r?.n || 0).catch(() => 0)

    if (strictCount >= 3) {
      // Re-emit the strict clause with params offset to the shared counter `i`.
      const base = i
      let sj = base
      const perCol = cols.map(col => `(${words.map(() => `${col} ILIKE $${sj++}`).join(' AND ')})`)
      havingClauses.push(`(${perCol.join(' OR ')})`)
      params.push(...strictParams)
      i = base + strictParams.length
    } else {
      const sc = buildProductSearchClause(search, 'rows.name', 'rows.row_sku', 'rows.search_vector', i)
      const nameIdx = sc.nextIdx
      havingClauses.push(`(${sc.clause} OR rows.variant_name ILIKE $${nameIdx} OR rows.sub_variant_name ILIKE $${nameIdx})`)
      params.push(...sc.params, `%${search.trim()}%`)
      i = nameIdx + 1
    }
  }
  if (categoryName) { havingClauses.push(`rows.category_name = $${i++}`); params.push(categoryName) }
  if (brandName)    { havingClauses.push(`rows.brand_name = $${i++}`);    params.push(brandName) }
  if (stockStatus === 'in_stock')     { havingClauses.push(`rows.inventory_quantity > 0`) }
  if (stockStatus === 'out_of_stock') { havingClauses.push(`rows.inventory_quantity <= 0`) }
  if (stockStatus === 'low_stock')    { havingClauses.push(`rows.inventory_quantity > 0 AND rows.inventory_quantity <= 5`) }

  const whereClause = havingClauses.length > 0 ? `WHERE ${havingClauses.join(' AND ')}` : ''

  // All distinct categories and brands (unfiltered, for dropdown population)
  const filterMeta = await queryMany<{ category_name: string | null; brand_name: string | null }>(
    `${baseQuery} SELECT DISTINCT rows.category_name, rows.brand_name FROM rows ORDER BY rows.category_name, rows.brand_name`,
    []
  )
  const allCategories = [...new Set(filterMeta.map(r => r.category_name).filter(Boolean))].sort() as string[]
  const allBrands = [...new Set(filterMeta.map(r => r.brand_name).filter(Boolean))].sort() as string[]

  // Count filtered rows + site-wide totals (across ALL matching SKUs, not just the page).
  const countRow = await queryOne<{ total: number; total_value: string; total_value_incl: string }>(
    `${baseQuery} SELECT COUNT(DISTINCT rows.id)::int AS total,
        SUM(rows.stock_value)::text AS total_value,
        SUM(rows.inventory_quantity * rows.selling_price)::text AS total_value_incl
       FROM rows ${whereClause}`,
    params
  )
  const total = countRow?.total || 0
  const totalValue = parseFloat(countRow?.total_value || '0') || 0
  const totalValueInclGst = parseFloat(countRow?.total_value_incl || '0') || 0
  const inStockCount = await queryOne<{ n: number }>(
    `${baseQuery} SELECT COUNT(DISTINCT rows.id)::int AS n FROM rows ${whereClause}${whereClause ? ' AND' : ' WHERE'} rows.inventory_quantity > 0`,
    params
  ).then(r => r?.n || 0).catch(() => 0)

  // Server-side sort (across ALL matching SKUs, not just the page). Whitelist columns.
  const VAL_SORT_COLS: Record<string, string> = {
    product: 'rows.name', variant: 'rows.variant_name', sku: 'rows.row_sku',
    stock: 'rows.inventory_quantity', price: 'rows.cost_price', value: 'rows.stock_value',
  }
  const sortCol = (sort && VAL_SORT_COLS[sort]) || null
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC'

  // Relevance ordering: when the user is searching (and hasn't picked an explicit
  // sort column), order paginated products by the shared product-search rank — same
  // as the line-item picker — so the strongest name match lands on page 1 instead of
  // being buried alphabetically behind loose fuzzy hits.
  let rankParams: any[] = []
  let productOrderBy: string
  if (sortCol) {
    productOrderBy = `ORDER BY MIN(${sortCol}) ${sortDir} NULLS LAST, MIN(rows.name)`
  } else if (search) {
    const rk = buildProductSearchRank(search, 'rows.name', 'rows.search_vector', i)
    rankParams = rk.params
    productOrderBy = `ORDER BY MIN(${rk.rank}) ASC, MIN(rows.name)`
    i = rk.nextIdx
  } else {
    productOrderBy = `ORDER BY MIN(rows.name)`
  }

  // Paginate over distinct product IDs, then fetch all leaves for those products.
  const pageParams = [...params, ...rankParams, limit, offset]
  const pagedProductIds = await queryMany<{ id: string }>(
    `${baseQuery} SELECT rows.id FROM rows ${whereClause} GROUP BY rows.id ${productOrderBy} LIMIT $${i} OFFSET $${i + 1}`,
    pageParams
  )
  const idList = (pagedProductIds || []).map(r => r.id)
  const products = idList.length > 0
    ? await queryMany<any>(
        `${baseQuery} SELECT rows.* FROM rows WHERE rows.id = ANY($1) ORDER BY rows.name, rows.variant_name, rows.sub_variant_name`,
        [idList]
      )
    : []

  return {
    products: products || [],
    total,
    totalValue: round2(totalValue),
    totalValueInclGst: round2(totalValueInclGst),
    inStockCount,
    allCategories,
    allBrands,
  }
}
