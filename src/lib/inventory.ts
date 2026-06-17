import { query, queryOne, queryMany, getClient } from './db'
import { PoolClient } from 'pg'
import { buildProductSearchClause } from './search'

export type TransactionType = 'purchase' | 'sale' | 'return' | 'adjustment'
export type ReferenceType = 'order' | 'grn' | 'manual' | 'cash_sale'

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
  }
) {
  const { productId, variantId, subVariantId, transactionType, quantityChange, referenceType, referenceId, notes } = params

  let currentStockRaw: number
  if (params.currentStock !== undefined) {
    currentStockRaw = params.currentStock
  } else if (subVariantId) {
    const row = await queryOne<{ stock_quantity: number }>(
      'SELECT inventory_quantity FROM product_sub_variants WHERE id = $1', [subVariantId])
    currentStockRaw = parseFloat(row?.stock_quantity as any) || 0
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
     reference_type, reference_id, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
  const values = [productId, variantId, subVariantId || null, transactionType, qtyChange, quantityAfter,
    referenceType, referenceId, notes || null]

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
    qtyReceived: number
    unitCost: number
  }
) {
  const { productId, variantId, qtyReceived, unitCost } = params

  if (variantId) {
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
      [Math.round(newCost * 100) / 100, variantId]
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
      [Math.round(newCost * 100) / 100, productId]
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
  const countRow = await queryOne<{ total: number }>(
    `SELECT COUNT(it.id)::int AS total
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     LEFT JOIN product_variants pv ON pv.id = it.variant_id
     WHERE ${where}`,
    params
  )
  const total = countRow?.total || 0

  const limit = filters.limit || 50
  const offset = filters.offset || 0
  params.push(limit, offset)

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
      p.id AS product_id,
      p.name AS product_name,
      p.sku AS product_sku,
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
    LEFT JOIN orders o  ON it.reference_type = 'order'     AND o.id  = it.reference_id
    LEFT JOIN cash_sales cs ON it.reference_type = 'cash_sale' AND cs.id = it.reference_id
    LEFT JOIN grns g    ON it.reference_type = 'grn'       AND g.id  = it.reference_id
    WHERE ${where}
    ORDER BY it.created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `, params)

  return { rows: rows || [], total }
}

export async function getStockValuation() {
  const products = await queryMany<any>(`
    SELECT
      p.id, p.name, p.sku, p.sku AS row_sku, p.inventory_quantity,
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
      su.dimension AS sell_unit_dimension
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_units su ON su.product_id = p.id AND su.is_sell_default = TRUE
      AND su.variant_id IS NULL AND su.sub_variant_id IS NULL
    WHERE p.has_variants = FALSE AND p.is_active = TRUE
    UNION ALL
    SELECT
      p.id, p.name, p.sku, pv.sku AS row_sku, pv.inventory_quantity,
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
      su.dimension AS sell_unit_dimension
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_units su ON su.product_id = p.id AND su.is_sell_default = TRUE
      AND su.variant_id = pv.id AND su.sub_variant_id IS NULL
    WHERE p.is_active = TRUE AND pv.is_active = TRUE
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = TRUE)
    UNION ALL
    SELECT
      p.id, p.name, p.sku, sv.sku AS row_sku, sv.inventory_quantity,
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
      su.dimension AS sell_unit_dimension
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN LATERAL (
      SELECT unit, display_label, dimension FROM product_units
      WHERE product_id = p.id AND is_sell_default = TRUE AND sub_variant_id = sv.id
      UNION ALL
      SELECT unit, display_label, dimension FROM product_units
      WHERE product_id = p.id AND is_sell_default = TRUE AND variant_id = pv.id AND sub_variant_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM product_units WHERE product_id = p.id AND is_sell_default = TRUE AND sub_variant_id = sv.id)
      UNION ALL
      SELECT unit, display_label, dimension FROM product_units
      WHERE product_id = p.id AND is_sell_default = TRUE AND variant_id IS NULL AND sub_variant_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM product_units WHERE product_id = p.id AND is_sell_default = TRUE AND (sub_variant_id = sv.id OR variant_id = pv.id))
      LIMIT 1
    ) su ON TRUE
    WHERE p.is_active = TRUE AND pv.is_active = TRUE AND sv.is_active = TRUE
    ORDER BY name, variant_name, sub_variant_name
  `)

  const totalValue = (products || []).reduce((sum, r) => sum + parseFloat(r.stock_value || '0'), 0)
  return { products: products || [], totalValue: Math.round(totalValue * 100) / 100 }
}
