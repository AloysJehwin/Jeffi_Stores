import { query, queryMany, queryOne } from '@/lib/db'

export interface Warehouse {
  id: string
  name: string
  code: string
  address: string | null
  is_active: boolean
  created_at: string
}

export interface ShelfLocation {
  id: string
  warehouse_id: string
  warehouse_name?: string
  warehouse_code?: string
  aisle_code: string
  rack_code: string
  shelf_code: string
  bin_code: string | null
  display_code: string
  notes: string | null
  is_active: boolean
  created_at: string
  stock_count?: number
}

export interface ShelfStock {
  id: string
  location_id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  quantity: number
  updated_at: string
  product_name?: string
  variant_name?: string | null
  sku?: string
}

function buildDisplayCode(warehouseCode: string, aisle: string, rack: string, shelf: string, bin?: string | null): string {
  const parts = [warehouseCode, aisle, rack, shelf]
  if (bin) parts.push(bin)
  return parts.join('-')
}

export async function listWarehouses(): Promise<Warehouse[]> {
  return queryMany<Warehouse>(
    `SELECT id, name, code, address, is_active, created_at
     FROM warehouses ORDER BY name ASC`
  )
}

export async function getWarehouse(id: string): Promise<Warehouse | null> {
  return queryOne<Warehouse>(
    `SELECT id, name, code, address, is_active, created_at FROM warehouses WHERE id = $1`,
    [id]
  )
}

export async function createWarehouse(name: string, code: string, address?: string | null): Promise<Warehouse> {
  const row = await queryOne<Warehouse>(
    `INSERT INTO warehouses (name, code, address) VALUES ($1, $2, $3) RETURNING *`,
    [name, code.toUpperCase(), address ?? null]
  )
  if (!row) throw new Error('Insert failed')
  return row
}

export async function updateWarehouse(id: string, fields: Partial<Pick<Warehouse, 'name' | 'code' | 'address' | 'is_active'>>): Promise<Warehouse> {
  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (fields.name !== undefined) { sets.push(`name = $${idx++}`); params.push(fields.name) }
  if (fields.code !== undefined) { sets.push(`code = $${idx++}`); params.push(fields.code.toUpperCase()) }
  if (fields.address !== undefined) { sets.push(`address = $${idx++}`); params.push(fields.address) }
  if (fields.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(fields.is_active) }
  if (sets.length === 0) throw new Error('No fields to update')
  params.push(id)
  const row = await queryOne<Warehouse>(
    `UPDATE warehouses SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  )
  if (!row) throw new Error('Warehouse not found')
  return row
}

export async function deleteWarehouse(id: string): Promise<void> {
  const hasStock = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM shelf_stock ss
     JOIN shelf_locations sl ON sl.id = ss.location_id
     WHERE sl.warehouse_id = $1 AND ss.quantity > 0`,
    [id]
  )
  if (Number(hasStock?.c) > 0) throw new Error('Cannot delete warehouse with stock assigned')
  await query(`DELETE FROM warehouses WHERE id = $1`, [id])
}

export async function listLocations(warehouseId?: string): Promise<ShelfLocation[]> {
  const where = warehouseId ? `WHERE sl.warehouse_id = $1` : ''
  const params = warehouseId ? [warehouseId] : []
  return queryMany<ShelfLocation>(
    `SELECT sl.id, sl.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
            sl.aisle_code, sl.rack_code, sl.shelf_code, sl.bin_code, sl.display_code,
            sl.notes, sl.is_active, sl.created_at,
            COALESCE((SELECT COUNT(DISTINCT product_id) FROM shelf_stock WHERE location_id = sl.id AND quantity > 0),0)::int AS stock_count
     FROM shelf_locations sl
     JOIN warehouses w ON w.id = sl.warehouse_id
     ${where}
     ORDER BY sl.aisle_code, sl.rack_code, sl.shelf_code, sl.bin_code NULLS FIRST`,
    params
  )
}

export async function getLocation(id: string): Promise<ShelfLocation | null> {
  return queryOne<ShelfLocation>(
    `SELECT sl.id, sl.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,
            sl.aisle_code, sl.rack_code, sl.shelf_code, sl.bin_code, sl.display_code,
            sl.notes, sl.is_active, sl.created_at
     FROM shelf_locations sl JOIN warehouses w ON w.id = sl.warehouse_id
     WHERE sl.id = $1`,
    [id]
  )
}

export async function createLocation(
  warehouseId: string,
  aisle: string,
  rack: string,
  shelf: string,
  bin?: string | null,
  notes?: string | null
): Promise<ShelfLocation> {
  const wh = await queryOne<{ code: string }>(`SELECT code FROM warehouses WHERE id = $1`, [warehouseId])
  if (!wh) throw new Error('Warehouse not found')
  const displayCode = buildDisplayCode(wh.code, aisle.toUpperCase(), rack, shelf.toUpperCase(), bin)
  const row = await queryOne<ShelfLocation>(
    `INSERT INTO shelf_locations (warehouse_id, aisle_code, rack_code, shelf_code, bin_code, display_code, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [warehouseId, aisle.toUpperCase(), rack, shelf.toUpperCase(), bin ?? null, displayCode, notes ?? null]
  )
  if (!row) throw new Error('Insert failed')
  return row
}

export async function updateLocation(id: string, fields: Partial<Pick<ShelfLocation, 'aisle_code' | 'rack_code' | 'shelf_code' | 'bin_code' | 'notes' | 'is_active'>>): Promise<ShelfLocation> {
  const current = await getLocation(id)
  if (!current) throw new Error('Location not found')

  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  const aisle = fields.aisle_code ?? current.aisle_code
  const rack = fields.rack_code ?? current.rack_code
  const shelf = fields.shelf_code ?? current.shelf_code
  const bin = 'bin_code' in fields ? fields.bin_code : current.bin_code
  const newDisplayCode = buildDisplayCode(current.warehouse_code!, aisle.toUpperCase(), rack, shelf.toUpperCase(), bin)

  sets.push(`aisle_code = $${idx++}`); params.push(aisle.toUpperCase())
  sets.push(`rack_code = $${idx++}`); params.push(rack)
  sets.push(`shelf_code = $${idx++}`); params.push(shelf.toUpperCase())
  sets.push(`bin_code = $${idx++}`); params.push(bin ?? null)
  sets.push(`display_code = $${idx++}`); params.push(newDisplayCode)
  if (fields.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(fields.notes) }
  if (fields.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(fields.is_active) }

  params.push(id)
  const row = await queryOne<ShelfLocation>(
    `UPDATE shelf_locations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  )
  if (!row) throw new Error('Location not found')
  return row
}

export async function deleteLocation(id: string): Promise<void> {
  const hasStock = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM shelf_stock WHERE location_id = $1 AND quantity > 0`,
    [id]
  )
  if (Number(hasStock?.c) > 0) throw new Error('Cannot delete location with stock assigned')
  await query(`DELETE FROM shelf_locations WHERE id = $1`, [id])
}

export async function getStockAtLocation(locationId: string): Promise<ShelfStock[]> {
  return queryMany<ShelfStock>(
    `SELECT ss.id, ss.location_id, ss.product_id, ss.variant_id, ss.sub_variant_id,
            ss.quantity, ss.updated_at,
            p.name AS product_name,
            COALESCE(ps.sub_variant_name || ' (' || pv.variant_name || ')', pv.variant_name) AS variant_name,
            COALESCE(ps.sku, pv.sku, p.sku) AS sku
     FROM shelf_stock ss
     JOIN products p ON p.id = ss.product_id
     LEFT JOIN product_variants pv ON pv.id = ss.variant_id
     LEFT JOIN product_sub_variants ps ON ps.id = ss.sub_variant_id
     WHERE ss.location_id = $1
     ORDER BY p.name, variant_name NULLS FIRST`,
    [locationId]
  )
}

export async function getStockForProduct(productId: string, variantId?: string | null, subVariantId?: string | null): Promise<{ location_display_code: string; quantity: number; variant_id: string | null; sub_variant_id: string | null }[]> {
  return queryMany(
    `SELECT sl.display_code AS location_display_code, ss.quantity, ss.variant_id, ss.sub_variant_id
     FROM shelf_stock ss
     JOIN shelf_locations sl ON sl.id = ss.location_id
     WHERE ss.product_id = $1
       AND ($2::uuid IS NULL OR ss.variant_id = $2)
       AND ($3::uuid IS NULL OR ss.sub_variant_id = $3)
     ORDER BY sl.display_code`,
    [productId, variantId ?? null, subVariantId ?? null]
  )
}

async function syncCentralInventory(
  client: any,
  productId: string,
  variantId: string | null,
  subVariantId: string | null
): Promise<void> {
  const totalRow = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS total FROM shelf_stock
     WHERE product_id = $1
       AND ($2::uuid IS NULL OR variant_id = $2)
       AND ($3::uuid IS NULL OR sub_variant_id = $3)`,
    [productId, variantId, subVariantId]
  )
  const total = totalRow.rows[0].total

  if (subVariantId) {
    await client.query(`UPDATE product_sub_variants SET stock_status = $1, updated_at = now() WHERE id = $2`, [total > 0 ? 'In Stock' : 'Out of Stock', subVariantId])
  } else if (variantId) {
    await client.query(`UPDATE product_variants SET inventory_quantity = $1, updated_at = now() WHERE id = $2`, [total, variantId])
  } else {
    await client.query(`UPDATE products SET inventory_quantity = $1, updated_at = now() WHERE id = $2`, [total, productId])
  }
}

export async function adjustStock(
  locationId: string,
  productId: string,
  variantId: string | null,
  subVariantId: string | null,
  quantityChange: number,
  reason: string,
  createdBy?: string | null
): Promise<ShelfStock> {
  const { getClient } = await import('@/lib/db')
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT id, quantity FROM shelf_stock
       WHERE location_id = $1 AND product_id = $2
         AND ($3::uuid IS NULL OR variant_id = $3) AND (variant_id IS NULL OR $3::uuid IS NOT NULL)
         AND ($4::uuid IS NULL OR sub_variant_id = $4) AND (sub_variant_id IS NULL OR $4::uuid IS NOT NULL)`,
      [locationId, productId, variantId, subVariantId]
    )

    let newQty: number
    let stockId: string

    if (existing.rows.length > 0) {
      newQty = Math.max(0, existing.rows[0].quantity + quantityChange)
      stockId = existing.rows[0].id
      if (newQty === 0) {
        await client.query(`DELETE FROM shelf_stock WHERE id = $1`, [existing.rows[0].id])
      } else {
        await client.query(
          `UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE id = $2`,
          [newQty, existing.rows[0].id]
        )
      }
    } else {
      newQty = Math.max(0, quantityChange)
      const ins = await client.query(
        `INSERT INTO shelf_stock (location_id, product_id, variant_id, sub_variant_id, quantity)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [locationId, productId, variantId, subVariantId, newQty]
      )
      stockId = ins.rows[0].id
    }

    await client.query(
      `INSERT INTO shelf_stock_transactions (location_id, product_id, variant_id, sub_variant_id, quantity_change, quantity_after, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [locationId, productId, variantId, subVariantId, quantityChange, newQty, reason, createdBy ?? null]
    )

    await syncCentralInventory(client, productId, variantId, subVariantId)

    await client.query('COMMIT')

    if (newQty === 0) {
      return { id: stockId, location_id: locationId, product_id: productId, variant_id: variantId, sub_variant_id: subVariantId, quantity: 0, updated_at: new Date().toISOString(), product_name: '', variant_name: null, sku: '' } as ShelfStock
    }
    const row = await queryOne<ShelfStock>(`SELECT * FROM shelf_stock WHERE id = $1`, [stockId])
    return row!
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function moveStock(
  fromLocationId: string,
  toLocationId: string,
  productId: string,
  variantId: string | null,
  subVariantId: string | null,
  qty: number,
  createdBy?: string | null
): Promise<void> {
  if (qty <= 0) throw new Error('Quantity must be positive')
  if (fromLocationId === toLocationId) throw new Error('Source and destination must differ')

  const { getClient } = await import('@/lib/db')
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const fromRow = await client.query(
      `SELECT id, quantity FROM shelf_stock
       WHERE location_id = $1 AND product_id = $2
         AND ($3::uuid IS NULL OR variant_id = $3) AND (variant_id IS NULL OR $3::uuid IS NOT NULL)
         AND ($4::uuid IS NULL OR sub_variant_id = $4) AND (sub_variant_id IS NULL OR $4::uuid IS NOT NULL)`,
      [fromLocationId, productId, variantId, subVariantId]
    )
    if (!fromRow.rows.length || fromRow.rows[0].quantity < qty) {
      throw new Error('Insufficient stock at source location')
    }

    const newFromQty = fromRow.rows[0].quantity - qty
    if (newFromQty === 0) {
      await client.query(`DELETE FROM shelf_stock WHERE id = $1`, [fromRow.rows[0].id])
    } else {
      await client.query(
        `UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE id = $2`,
        [newFromQty, fromRow.rows[0].id]
      )
    }
    await client.query(
      `INSERT INTO shelf_stock_transactions (location_id, product_id, variant_id, sub_variant_id, quantity_change, quantity_after, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'move_out', $7)`,
      [fromLocationId, productId, variantId, subVariantId, -qty, newFromQty, createdBy ?? null]
    )

    const toRow = await client.query(
      `SELECT id, quantity FROM shelf_stock
       WHERE location_id = $1 AND product_id = $2
         AND ($3::uuid IS NULL OR variant_id = $3) AND (variant_id IS NULL OR $3::uuid IS NOT NULL)
         AND ($4::uuid IS NULL OR sub_variant_id = $4) AND (sub_variant_id IS NULL OR $4::uuid IS NOT NULL)`,
      [toLocationId, productId, variantId, subVariantId]
    )
    let newToQty: number
    if (toRow.rows.length > 0) {
      newToQty = toRow.rows[0].quantity + qty
      await client.query(
        `UPDATE shelf_stock SET quantity = $1, updated_at = now() WHERE id = $2`,
        [newToQty, toRow.rows[0].id]
      )
    } else {
      newToQty = qty
      await client.query(
        `INSERT INTO shelf_stock (location_id, product_id, variant_id, sub_variant_id, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [toLocationId, productId, variantId, subVariantId, newToQty]
      )
    }
    await client.query(
      `INSERT INTO shelf_stock_transactions (location_id, product_id, variant_id, sub_variant_id, quantity_change, quantity_after, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'move_in', $7)`,
      [toLocationId, productId, variantId, subVariantId, qty, newToQty, createdBy ?? null]
    )

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
