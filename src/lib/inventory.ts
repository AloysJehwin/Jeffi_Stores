import { query, queryOne, queryMany, getClient } from './db'
import { PoolClient } from 'pg'

export type TransactionType = 'purchase' | 'sale' | 'return' | 'adjustment'
export type ReferenceType = 'order' | 'grn' | 'manual'

export async function logStockMovement(
  client: PoolClient | null,
  params: {
    productId: string
    variantId: string | null
    transactionType: TransactionType
    quantityChange: number
    referenceType: ReferenceType
    referenceId: string
    notes?: string
  }
) {
  const { productId, variantId, transactionType, quantityChange, referenceType, referenceId, notes } = params

  const currentStock = variantId
    ? await queryOne<{ stock_quantity: number }>(
        'SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])
    : await queryOne<{ stock_quantity: number }>(
        'SELECT stock_quantity FROM products WHERE id = $1', [productId])

  const quantityAfter = (currentStock?.stock_quantity || 0) + quantityChange

  const sql = `INSERT INTO inventory_transactions
    (product_id, variant_id, transaction_type, quantity_change, quantity_after,
     reference_type, reference_id, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
  const values = [productId, variantId, transactionType, quantityChange, quantityAfter,
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
    const row = await client.query<{ stock_quantity: number; cost_price: number }>(
      'SELECT stock_quantity, cost_price FROM product_variants WHERE id = $1 FOR UPDATE', [variantId])
    const cur = row.rows[0]
    const curStock = parseFloat(cur?.stock_quantity as any) || 0
    const curCost = parseFloat(cur?.cost_price as any) || 0
    const newCost = curStock + qtyReceived > 0
      ? (curStock * curCost + qtyReceived * unitCost) / (curStock + qtyReceived)
      : unitCost
    await client.query(
      'UPDATE product_variants SET cost_price = $1 WHERE id = $2',
      [Math.round(newCost * 100) / 100, variantId]
    )
  } else {
    const row = await client.query<{ stock_quantity: number; cost_price: number }>(
      'SELECT stock_quantity, cost_price FROM products WHERE id = $1 FOR UPDATE', [productId])
    const cur = row.rows[0]
    const curStock = parseFloat(cur?.stock_quantity as any) || 0
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
}) {
  const conditions: string[] = ['1=1']
  const params: any[] = []
  let i = 1

  if (filters.productId) { conditions.push(`it.product_id = $${i++}`); params.push(filters.productId) }
  if (filters.from) { conditions.push(`it.created_at >= $${i++}`); params.push(filters.from) }
  if (filters.to) { conditions.push(`it.created_at <= $${i++}`); params.push(filters.to + ' 23:59:59') }
  if (filters.search) {
    conditions.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR pv.variant_name ILIKE $${i})`)
    params.push(`%${filters.search}%`)
    i++
  }

  const limit = filters.limit || 200
  params.push(limit)

  return queryMany<any>(`
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
      pv.cost_price AS variant_cost_price
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    LEFT JOIN product_variants pv ON pv.id = it.variant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY it.created_at DESC
    LIMIT $${i}
  `, params)
}

export async function getStockValuation() {
  const products = await queryMany<any>(`
    SELECT
      p.id, p.name, p.sku, p.stock_quantity, p.cost_price,
      COALESCE(p.stock_quantity, 0) * COALESCE(p.cost_price, 0) AS stock_value,
      NULL::uuid AS variant_id,
      NULL AS variant_name,
      FALSE AS has_variants
    FROM products p
    WHERE p.has_variants = FALSE AND p.is_active = TRUE
    UNION ALL
    SELECT
      p.id, p.name, p.sku, pv.stock_quantity, pv.cost_price,
      COALESCE(pv.stock_quantity, 0) * COALESCE(pv.cost_price, 0) AS stock_value,
      pv.id AS variant_id,
      pv.variant_name,
      TRUE AS has_variants
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE p.is_active = TRUE AND pv.is_active = TRUE
    ORDER BY name, variant_name
  `)

  const totalValue = (products || []).reduce((sum, r) => sum + parseFloat(r.stock_value || '0'), 0)
  return { products: products || [], totalValue: Math.round(totalValue * 100) / 100 }
}
