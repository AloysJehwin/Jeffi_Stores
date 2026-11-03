import type { PoolClient } from 'pg'

// Publish-time removal of variants / sub-variants whose toggle was turned off in the draft.
// A row is hard-deleted (with the rows that exist only for it: units, suppliers, images,
// shelf / batch / in-stock serial rows) unless history references it, in which case it is
// deactivated instead. References are checked explicitly, not via FK errors: several FKs
// cascade (inventory_transactions, cart_items) and some are missing on prod.

type Ref = { table: string; column: string; kind: 'variant' | 'sub'; where?: string }

const HISTORY_REFS: Ref[] = [
  ...[
    'order_items',
    'cart_items',
    'inventory_transactions',
    'shelf_stock_transactions',
    'purchase_order_items',
    'grn_items',
    'quotation_items',
    'business_rfq_items',
    'cash_sale_items',
    'subscriptions',
  ].flatMap(table => [
    { table, column: 'variant_id', kind: 'variant' as const },
    { table, column: 'sub_variant_id', kind: 'sub' as const },
  ]),
  { table: 'return_request_items', column: 'variant_id', kind: 'variant' },
  { table: 'amazon_order_items', column: 'variant_id', kind: 'variant' },
  { table: 'amazon_inventory_state', column: 'variant_id', kind: 'variant' },
  { table: 'order_adjustment_lines', column: 'new_variant_id', kind: 'variant' },
  { table: 'order_adjustment_lines', column: 'new_sub_variant_id', kind: 'sub' },
  { table: 'variant_change_requests', column: 'old_variant_id', kind: 'variant' },
  { table: 'variant_change_requests', column: 'new_variant_id', kind: 'variant' },
  { table: 'variant_change_requests', column: 'old_sub_variant_id', kind: 'sub' },
  { table: 'variant_change_requests', column: 'new_sub_variant_id', kind: 'sub' },
  { table: 'product_serials', column: 'variant_id', kind: 'variant', where: "status <> 'in_stock'" },
  { table: 'product_serials', column: 'sub_variant_id', kind: 'sub', where: "status <> 'in_stock'" },
]

// Owned rows that point at history through their own id (a batch sold from, a unit moved in).
const OWNED_REFS: { owner: string; table: string; column: string }[] = [
  { owner: 'product_batches', table: 'order_items', column: 'batch_id' },
  { owner: 'product_batches', table: 'inventory_transactions', column: 'batch_id' },
  { owner: 'product_units', table: 'inventory_transactions', column: 'unit_id' },
]

export interface PurgeResult {
  deletedVariantIds: string[]
  deletedSubVariantIds: string[]
  deactivated: { kind: 'variant' | 'sub_variant'; id: string; referencedBy: string[] }[]
}

async function existingColumns(client: PoolClient): Promise<Set<string>> {
  const tables = [...new Set([...HISTORY_REFS, ...OWNED_REFS].map(r => r.table))]
  const r = await client.query<{ t: string }>(
    `SELECT table_name || '.' || column_name AS t FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tables]
  )
  return new Set(r.rows.map(x => x.t))
}

async function referencedBy(
  client: PoolClient,
  cols: Set<string>,
  kind: 'variant' | 'sub',
  id: string
): Promise<string[]> {
  const hits = new Set<string>()
  for (const ref of HISTORY_REFS) {
    if (ref.kind !== kind || !cols.has(`${ref.table}.${ref.column}`)) continue
    const r = await client.query(
      `SELECT 1 FROM ${ref.table} WHERE ${ref.column} = $1::uuid${ref.where ? ` AND ${ref.where}` : ''} LIMIT 1`,
      [id]
    )
    if (r.rows.length > 0) hits.add(ref.table)
  }
  const grain = kind === 'sub' ? 'sub_variant_id = $1::uuid' : 'variant_id = $1::uuid AND sub_variant_id IS NULL'
  for (const ref of OWNED_REFS) {
    if (!cols.has(`${ref.table}.${ref.column}`)) continue
    const r = await client.query(
      `SELECT 1 FROM ${ref.table} WHERE ${ref.column} IN (SELECT id FROM ${ref.owner} WHERE ${grain}) LIMIT 1`,
      [id]
    )
    if (r.rows.length > 0) hits.add(`${ref.table} (via ${ref.owner})`)
  }
  return [...hits]
}

async function deleteInSavepoint(client: PoolClient, statements: [string, unknown[]][]): Promise<string | null> {
  await client.query('SAVEPOINT variant_purge')
  try {
    for (const [sql, params] of statements) await client.query(sql, params)
    await client.query('RELEASE SAVEPOINT variant_purge')
    return null
  } catch (e: any) {
    await client.query('ROLLBACK TO SAVEPOINT variant_purge')
    return [e?.table, e?.constraint].filter(Boolean).join(' / ') || e?.message || 'delete failed'
  }
}

/** Remove the given sub-variants, and the given variants with all their sub-variants. */
export async function purgeVariantRows(
  client: PoolClient,
  productId: string,
  opts: { variantIds?: string[]; subVariantIds?: string[] }
): Promise<PurgeResult> {
  const out: PurgeResult = { deletedVariantIds: [], deletedSubVariantIds: [], deactivated: [] }
  const variantIds = [...new Set(opts.variantIds || [])]
  const subRows = await client.query<{ id: string; variant_id: string }>(
    `SELECT id, variant_id FROM product_sub_variants
      WHERE product_id = $1 AND (id = ANY($2::uuid[]) OR variant_id = ANY($3::uuid[]))`,
    [productId, opts.subVariantIds || [], variantIds]
  )
  if (subRows.rows.length === 0 && variantIds.length === 0) return out
  const cols = await existingColumns(client)
  const keptSubParents = new Set<string>()

  for (const sv of subRows.rows) {
    const refs = await referencedBy(client, cols, 'sub', sv.id)
    const failed =
      refs.length > 0
        ? null
        : await deleteInSavepoint(client, [
            [`DELETE FROM product_units WHERE sub_variant_id = $1`, [sv.id]],
            [`DELETE FROM product_suppliers WHERE sub_variant_id = $1`, [sv.id]],
            [`DELETE FROM shelf_stock WHERE sub_variant_id = $1`, [sv.id]],
            [`DELETE FROM product_serials WHERE sub_variant_id = $1 AND status = 'in_stock'`, [sv.id]],
            [`DELETE FROM product_batches WHERE sub_variant_id = $1`, [sv.id]],
            [`DELETE FROM product_sub_variants WHERE id = $1 AND product_id = $2`, [sv.id, productId]],
          ])
    if (refs.length === 0 && !failed) {
      out.deletedSubVariantIds.push(sv.id)
      continue
    }
    await client.query(`UPDATE product_sub_variants SET is_active = false, updated_at = NOW() WHERE id = $1`, [sv.id])
    out.deactivated.push({ kind: 'sub_variant', id: sv.id, referencedBy: refs.length > 0 ? refs : [failed!] })
    keptSubParents.add(sv.variant_id)
  }

  for (const vid of variantIds) {
    // A kept sub-variant still points at its parent (ON DELETE CASCADE would take it along).
    const refs = keptSubParents.has(vid)
      ? ['product_sub_variants (kept sub-variants)']
      : await referencedBy(client, cols, 'variant', vid)
    const failed =
      refs.length > 0
        ? null
        : await deleteInSavepoint(client, [
            [`DELETE FROM product_units WHERE variant_id = $1`, [vid]],
            [`DELETE FROM product_suppliers WHERE variant_id = $1`, [vid]],
            [`DELETE FROM variant_images WHERE variant_id = $1`, [vid]],
            [`DELETE FROM shelf_stock WHERE variant_id = $1`, [vid]],
            [`DELETE FROM product_serials WHERE variant_id = $1 AND status = 'in_stock'`, [vid]],
            [`DELETE FROM product_batches WHERE variant_id = $1`, [vid]],
            [`DELETE FROM product_variants WHERE id = $1 AND product_id = $2`, [vid, productId]],
          ])
    if (refs.length === 0 && !failed) {
      out.deletedVariantIds.push(vid)
      continue
    }
    await client.query(`UPDATE product_variants SET is_active = false, updated_at = NOW() WHERE id = $1`, [vid])
    out.deactivated.push({ kind: 'variant', id: vid, referencedBy: refs.length > 0 ? refs : [failed!] })
  }
  return out
}
