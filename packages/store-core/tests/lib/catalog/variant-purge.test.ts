import { describe, it, expect } from 'vitest'
import { purgeVariantRows } from '@/lib/catalog/variant-purge'

// Fake PoolClient: route each query by its SQL text so test setup is explicit
// and order-independent. Records all calls for assertions.
type Resp = { rows: any[] }
function makeClient(handlers: {
  subVariants?: Resp
  columns?: Resp
  // referencedBy probes: match by substring -> rows
  refs?: Array<{ match: string; rows: any[] }>
  // make a specific DELETE throw (to exercise the savepoint catch)
  throwOn?: string
  throwErr?: any
}) {
  const calls: { sql: string; params: any[] }[] = []
  const query = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params })
    if (/FROM product_sub_variants\s+WHERE product_id/.test(sql)) return handlers.subVariants ?? { rows: [] }
    if (sql.includes('information_schema.columns')) return handlers.columns ?? { rows: [] }
    if (handlers.throwOn && sql.includes(handlers.throwOn)) {
      throw handlers.throwErr ?? Object.assign(new Error('boom'), { table: 't', constraint: 'c' })
    }
    if (sql.startsWith('SELECT 1 FROM')) {
      const hit = (handlers.refs ?? []).find(r => sql.includes(r.match))
      return { rows: hit?.rows ?? [] }
    }
    return { rows: [] }
  }
  return { client: { query } as any, calls }
}

// Give every referenced table/column so referencedBy actually probes.
const allColumns = {
  rows: [
    { t: 'order_items.variant_id' },
    { t: 'order_items.sub_variant_id' },
    { t: 'order_items.batch_id' },
    { t: 'cart_items.variant_id' },
    { t: 'cart_items.sub_variant_id' },
    { t: 'product_serials.variant_id' },
    { t: 'product_serials.sub_variant_id' },
    { t: 'inventory_transactions.batch_id' },
    { t: 'inventory_transactions.unit_id' },
  ],
}

describe('purgeVariantRows', () => {
  it('returns empty result without reading columns when nothing is targeted', async () => {
    const { client, calls } = makeClient({ subVariants: { rows: [] } })
    const out = await purgeVariantRows(client, 'prod', {})
    expect(out).toEqual({ deletedVariantIds: [], deletedSubVariantIds: [], deactivated: [] })
    // only the sub-variant lookup ran; no information_schema read
    expect(calls.some(c => c.sql.includes('information_schema'))).toBe(false)
  })

  it('hard-deletes an unreferenced sub-variant inside a savepoint', async () => {
    const { client, calls } = makeClient({
      subVariants: { rows: [{ id: 'sv1', variant_id: 'v1' }] },
      columns: allColumns,
      refs: [], // no history references
    })
    const out = await purgeVariantRows(client, 'prod', { subVariantIds: ['sv1'] })
    expect(out.deletedSubVariantIds).toEqual(['sv1'])
    expect(out.deactivated).toEqual([])
    // savepoint lifecycle + the delete set ran
    expect(calls.some(c => c.sql === 'SAVEPOINT variant_purge')).toBe(true)
    expect(calls.some(c => c.sql === 'RELEASE SAVEPOINT variant_purge')).toBe(true)
    expect(calls.some(c => c.sql.includes('DELETE FROM product_sub_variants WHERE id = $1'))).toBe(true)
  })

  it('deactivates a referenced sub-variant instead of deleting it', async () => {
    const { client, calls } = makeClient({
      subVariants: { rows: [{ id: 'sv1', variant_id: 'v1' }] },
      columns: allColumns,
      refs: [{ match: 'FROM order_items WHERE sub_variant_id', rows: [{ '?column?': 1 }] }],
    })
    const out = await purgeVariantRows(client, 'prod', { subVariantIds: ['sv1'] })
    expect(out.deletedSubVariantIds).toEqual([])
    expect(out.deactivated).toEqual([
      { kind: 'sub_variant', id: 'sv1', referencedBy: ['order_items'] },
    ])
    expect(calls.some(c => c.sql.includes('UPDATE product_sub_variants SET is_active = false'))).toBe(true)
    // never entered a savepoint since it was referenced
    expect(calls.some(c => c.sql === 'SAVEPOINT variant_purge')).toBe(false)
  })

  it('rolls back and deactivates when a delete throws, surfacing table/constraint', async () => {
    const { client } = makeClient({
      subVariants: { rows: [{ id: 'sv1', variant_id: 'v1' }] },
      columns: allColumns,
      refs: [],
      throwOn: 'DELETE FROM product_batches WHERE sub_variant_id',
      throwErr: Object.assign(new Error('fk'), { table: 'product_batches', constraint: 'pb_fk' }),
    })
    const out = await purgeVariantRows(client, 'prod', { subVariantIds: ['sv1'] })
    expect(out.deletedSubVariantIds).toEqual([])
    expect(out.deactivated[0]).toEqual({
      kind: 'sub_variant',
      id: 'sv1',
      referencedBy: ['product_batches / pb_fk'],
    })
  })

  it('hard-deletes an unreferenced variant and its sub-variants', async () => {
    const { client, calls } = makeClient({
      // variantIds drives the second subRows arm (variant_id = ANY)
      subVariants: { rows: [{ id: 'sv1', variant_id: 'v1' }] },
      columns: allColumns,
      refs: [],
    })
    const out = await purgeVariantRows(client, 'prod', { variantIds: ['v1'] })
    expect(out.deletedSubVariantIds).toEqual(['sv1'])
    expect(out.deletedVariantIds).toEqual(['v1'])
    expect(calls.some(c => c.sql.includes('DELETE FROM product_variants WHERE id = $1'))).toBe(true)
  })

  it('keeps a variant alive when one of its sub-variants was kept', async () => {
    const { client } = makeClient({
      subVariants: { rows: [{ id: 'sv1', variant_id: 'v1' }] },
      columns: allColumns,
      // sub-variant is referenced -> kept -> parent must be deactivated, not deleted
      refs: [{ match: 'FROM cart_items WHERE sub_variant_id', rows: [{ x: 1 }] }],
    })
    const out = await purgeVariantRows(client, 'prod', { variantIds: ['v1'] })
    expect(out.deletedVariantIds).toEqual([])
    const variantEntry = out.deactivated.find(d => d.kind === 'variant')
    expect(variantEntry).toEqual({
      kind: 'variant',
      id: 'v1',
      referencedBy: ['product_sub_variants (kept sub-variants)'],
    })
  })

  it('dedupes requested variant ids and skips columns not present in schema', async () => {
    const { client, calls } = makeClient({
      subVariants: { rows: [] },
      columns: { rows: [] }, // no columns exist -> referencedBy returns []
      refs: [],
    })
    const out = await purgeVariantRows(client, 'prod', { variantIds: ['v1', 'v1'] })
    expect(out.deletedVariantIds).toEqual(['v1'])
    // only one variant delete block despite the duplicate
    const variantDeletes = calls.filter(c => c.sql.includes('DELETE FROM product_variants WHERE id = $1'))
    expect(variantDeletes).toHaveLength(1)
  })

  it('detects an owned-row reference (batch sold from)', async () => {
    const { client } = makeClient({
      subVariants: { rows: [] },
      columns: allColumns,
      refs: [{ match: 'SELECT id FROM product_batches', rows: [{ x: 1 }] }],
    })
    const out = await purgeVariantRows(client, 'prod', { variantIds: ['v1'] })
    expect(out.deactivated[0].referencedBy).toContain('order_items (via product_batches)')
  })
})
