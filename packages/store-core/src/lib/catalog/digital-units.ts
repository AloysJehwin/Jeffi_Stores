// Digital products sell as one piece: no selling units, buy_mode 'unit', qty 1.

export const DIGITAL_UNIT_MESSAGE = 'Digital products sell as 1 pc'

const PIECE_UNITS = new Set(['unit', 'units', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'each'])

export function isPieceUnit(unit: string | null | undefined): boolean {
  return unit == null || unit === '' || PIECE_UNITS.has(String(unit).trim().toLowerCase())
}

/** Error when a digital line asks for a non-piece unit, else null. */
export function digitalUnitError(
  buyMode: string | null | undefined,
  buyUnit: string | null | undefined
): string | null {
  return isPieceUnit(buyMode) && isPieceUnit(buyUnit) ? null : DIGITAL_UNIT_MESSAGE
}

interface Exec {
  query: (sql: string, params?: unknown[]) => Promise<unknown>
}

/** Reset a digital product to the plain single-piece shape of a new simple product. */
export async function stripDigitalUnits(db: Exec, productId: string): Promise<void> {
  await db.query(`UPDATE products SET sell_unit_id = NULL WHERE id = $1 AND sell_unit_id IS NOT NULL`, [productId])
  await db.query(`DELETE FROM product_units WHERE product_id = $1`, [productId])
}

/** Digital stock is never tracked: drop shelf/batch/in-stock serial rows and zero every grain. */
export async function zeroDigitalStock(db: Exec, productId: string): Promise<void> {
  await db.query(`DELETE FROM shelf_stock WHERE product_id = $1`, [productId])
  await db.query(`DELETE FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`, [productId])
  await db.query(`DELETE FROM product_batches WHERE product_id = $1`, [productId])
  await db.query(`UPDATE product_sub_variants SET inventory_quantity = 0 WHERE product_id = $1`, [productId])
  await db.query(`UPDATE product_variants SET inventory_quantity = 0 WHERE product_id = $1`, [productId])
  await db.query(
    `UPDATE products SET inventory_quantity = 0, stock_status = 'In Stock', perishable = FALSE, serialized = FALSE,
            inventory_sync = FALSE, low_stock_threshold = NULL, updated_at = NOW()
      WHERE id = $1`,
    [productId]
  )
}

export async function normalizeDigitalProduct(db: Exec, productId: string): Promise<void> {
  await zeroDigitalStock(db, productId)
  await stripDigitalUnits(db, productId)
}
