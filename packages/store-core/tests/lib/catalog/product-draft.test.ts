import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB layer and every cross-module import product-draft.ts pulls in.
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/orders/inventory', () => ({ recomputeStockStatusForProduct: vi.fn() }))
vi.mock('@/lib/catalog/selling-unit', () => ({
  assertUnitChangeAllowed: vi.fn(),
  changedUnitFields: vi.fn(() => ({})),
}))
vi.mock('@/lib/catalog/digital-units', () => ({ normalizeDigitalProduct: vi.fn() }))
vi.mock('@/lib/subscriptions/sellable', () => ({
  normalizeSubscriptionPrice: vi.fn(),
  normalizeSubscriptionPrices: vi.fn(),
}))
vi.mock('@/lib/subscriptions/intervals', () => ({
  cycleLimitsError: vi.fn(() => null),
  normalizeCycleCount: vi.fn((v: unknown) => (v == null ? null : Number(v))),
}))
vi.mock('@/lib/catalog/sku', () => ({ generateVariantSku: vi.fn((p: string, n: string) => `${p}-${n}`) }))
vi.mock('@/lib/catalog/variant-purge', () => ({ purgeVariantRows: vi.fn() }))
vi.mock('@/lib/catalog/product-validation', () => ({
  duplicateSkuError: vi.fn(() => null),
  friendlyProductDbError: vi.fn((e: unknown) => e),
  ProductValidationError: class ProductValidationError extends Error {},
  skuConflictError: vi.fn(async () => null),
  uniqueProductSlug: vi.fn(async (_db: unknown, s: string) => s),
}))
vi.mock('@/lib/admin/draft-locks', () => ({
  announceDraftClosed: vi.fn(),
  assertDraftHolder: vi.fn(),
  closeDraftLockTx: vi.fn(async () => null),
  isDraftLockError: vi.fn(() => false),
}))
vi.mock('@/lib/admin/entity-revisions', () => ({
  currentRevision: vi.fn(async () => 0),
  recordRevision: vi.fn(),
}))
vi.mock('@/lib/admin/draft-branches', () => ({ notifyDraftSiblings: vi.fn() }))
vi.mock('@/lib/catalog/product-extra-fields', () => ({
  extraFieldsSetSql: vi.fn(() => ({ sql: '', params: [] })),
  normalizeExtraFields: vi.fn((v: unknown) => v),
}))
vi.mock('@/lib/catalog/product-media', () => ({
  applyProductFaqsTx: vi.fn(),
  applyProductMediaTx: vi.fn(),
  syncLegacyImagesToMedia: vi.fn(),
}))
vi.mock('@/lib/catalog/product-draft-merge', () => ({
  liveProductSnapshot: vi.fn(async () => null),
  mergeProductDraft: vi.fn(),
}))
vi.mock('@/lib/vault/files', () => ({ applyDraftFileOpsTx: vi.fn(), releaseFileObjects: vi.fn() }))

import {
  openOrdersForProduct,
  publishProductDraft,
  OpenOrdersBlockError,
  UnitChangeBlockedError,
} from '@/lib/catalog/product-draft'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { liveProductSnapshot } from '@/lib/catalog/product-draft-merge'
import { cycleLimitsError } from '@/lib/subscriptions/intervals'
import { assertUnitChangeAllowed } from '@/lib/catalog/selling-unit'

const mQuery = vi.mocked(query)
const mQueryOne = vi.mocked(queryOne)
const mQueryMany = vi.mocked(queryMany)
const mLiveSnap = vi.mocked(liveProductSnapshot)
const mCycleErr = vi.mocked(cycleLimitsError)
const mAssertUnit = vi.mocked(assertUnitChangeAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mQuery.mockResolvedValue({ rows: [] } as any)
  mQueryOne.mockResolvedValue(null as any)
  mQueryMany.mockResolvedValue([] as any)
  mLiveSnap.mockResolvedValue(null as any)
  mCycleErr.mockReturnValue(null)
  mAssertUnit.mockResolvedValue(null as any)
})

describe('openOrdersForProduct', () => {
  it('returns the distinct open order numbers', async () => {
    mQueryMany.mockResolvedValueOnce([{ order_number: 'O-1' }, { order_number: 'O-2' }] as any)
    const r = await openOrdersForProduct('p1')
    expect(r).toEqual(['O-1', 'O-2'])
    const [sql, args] = mQueryMany.mock.calls[0]
    expect(String(sql)).toContain("o.status IN ('pending', 'confirmed')")
    expect(String(sql)).toContain('SELECT DISTINCT o.order_number')
    expect(args).toEqual(['p1'])
  })

  it('returns [] when none', async () => {
    mQueryMany.mockResolvedValueOnce([] as any)
    expect(await openOrdersForProduct('p1')).toEqual([])
  })
})

describe('OpenOrdersBlockError', () => {
  it('names itself and lists the orders', () => {
    const e = new OpenOrdersBlockError(['O-1', 'O-2'])
    expect(e.name).toBe('OpenOrdersBlockError')
    expect(e.orderNumbers).toEqual(['O-1', 'O-2'])
    expect(e.message).toContain('2 open order(s)')
    expect(e.message).toContain('O-1, O-2')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('UnitChangeBlockedError', () => {
  it('carries the reason and its name', () => {
    const e = new UnitChangeBlockedError('stock exists')
    expect(e.name).toBe('UnitChangeBlockedError')
    expect(e.message).toBe('stock exists')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('publishProductDraft — early guards', () => {
  it('throws when the draft is not found (by draftId)', async () => {
    mQueryOne.mockResolvedValueOnce(null) // draft lookup
    await expect(publishProductDraft('p1', { draftId: 'd-missing' })).rejects.toThrow('Draft not found')
    const [sql, args] = mQueryOne.mock.calls[0]
    expect(String(sql)).toContain('WHERE id = $1 AND product_id = $2')
    expect(args).toEqual(['d-missing', 'p1'])
  })

  it('looks up the newest draft when no draftId given', async () => {
    mQueryOne.mockResolvedValueOnce(null)
    await expect(publishProductDraft('p1')).rejects.toThrow('Draft not found')
    expect(String(mQueryOne.mock.calls[0][0])).toContain('ORDER BY updated_at DESC LIMIT 1')
  })

  it('blocks publish with OpenOrdersBlockError when open orders exist', async () => {
    // draft row
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1', fields: {}, variants: [], images: [], sub_variants: [], units: [], variant_images: [],
    } as any)
    // liveProductSnapshot null -> no merge; open orders query returns rows
    mQueryMany.mockResolvedValueOnce([{ order_number: 'O-9' }] as any) // openOrdersForProduct
    await expect(publishProductDraft('p1')).rejects.toBeInstanceOf(OpenOrdersBlockError)
  })

  it('throws the cycle-limit error before any write', async () => {
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1',
      fields: { subscription_total_cycles: 2, subscription_min_cycles: 5 },
      variants: [], images: [], sub_variants: [], units: [], variant_images: [],
    } as any)
    mQueryMany.mockResolvedValueOnce([] as any) // no open orders
    // liveFlags lookup
    mQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: false, sku: 'SKU1' } as any)
    mCycleErr.mockReturnValueOnce('min cannot exceed total')
    await expect(publishProductDraft('p1')).rejects.toThrow('min cannot exceed total')
  })

  it('blocks a staged base unit change via UnitChangeBlockedError', async () => {
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1', fields: {},
      variants: [], images: [], sub_variants: [],
      units: [{ is_base: true, factor: '2', dimension: 'count', qty_step: '1' }],
      variant_images: [],
    } as any)
    mQueryMany.mockResolvedValueOnce([] as any) // open orders
    mQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: false, sku: 'SKU1' } as any) // liveFlags
    // liveActiveVariants, liveActiveSubVariants, liveVariantRows -> []
    // assertStagedUnitChangesAllowed: the product-base guard reads the live base unit
    mQueryOne.mockResolvedValueOnce({ unit: 'box', factor: '1', dimension: 'count', qty_step: '1', display_label: 'Box' } as any)
    mAssertUnit.mockResolvedValueOnce('stock recorded under box' as any)
    await expect(publishProductDraft('p1')).rejects.toBeInstanceOf(UnitChangeBlockedError)
    expect(mAssertUnit).toHaveBeenCalled()
  })

  it('passes the unit guard when no live base unit exists for the scope', async () => {
    // Drives assertStagedUnitChangesAllowed's `if (!live) return` and then fails later
    // (skuConflict/validation is mocked to pass; the publish proceeds into withTransaction
    //  which is mocked to resolve) — we only assert the unit guard did not block.
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1', fields: {},
      variants: [], images: [], sub_variants: [],
      units: [{ is_base: true, factor: '2', dimension: 'count', qty_step: '1' }],
      variant_images: [],
    } as any)
    mQueryMany.mockResolvedValueOnce([] as any) // open orders
    mQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: false, sku: 'SKU1' } as any)
    mQueryOne.mockResolvedValueOnce(null) // no live base unit -> guard returns early
    // The rest of publish may throw or resolve depending on the tx mock; we only care the
    // unit guard did not raise UnitChangeBlockedError.
    const p = publishProductDraft('p1').catch(e => e)
    const res = await p
    expect(res).not.toBeInstanceOf(UnitChangeBlockedError)
    expect(mAssertUnit).not.toHaveBeenCalled()
  })

  it('skips the unit guard for a scope marked _reset_stock_on_publish', async () => {
    // A base unit change confirmed with a reset override is allowed without a live lookup.
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1', fields: {},
      variants: [], images: [], sub_variants: [],
      units: [{ is_base: true, factor: '2', dimension: 'count', qty_step: '1', _reset_stock_on_publish: true }],
      variant_images: [],
    } as any)
    mQueryMany.mockResolvedValueOnce([] as any) // open orders
    mQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: false, sku: 'SKU1' } as any)
    const res = await publishProductDraft('p1').catch(e => e)
    expect(res).not.toBeInstanceOf(UnitChangeBlockedError)
    expect(mAssertUnit).not.toHaveBeenCalled()
  })

  it('guards variant- and sub-variant-grain base units', async () => {
    mQueryOne.mockResolvedValueOnce({
      id: 'd1', product_id: 'p1', fields: {},
      variants: [], images: [], sub_variants: [],
      units: [
        { is_base: true, variant_id: 'v1', factor: '2', dimension: 'count', qty_step: '1' },
        { is_base: true, sub_variant_id: 'sv1', factor: '3', dimension: 'count', qty_step: '1' },
        { is_base: false, variant_id: 'v2', factor: '9' }, // non-base, ignored by base maps
        { _cleared: true, variant_id: 'v3' }, // cleared, skipped
      ],
      variant_images: [],
    } as any)
    mQueryMany.mockResolvedValueOnce([] as any) // open orders
    mQueryOne.mockResolvedValueOnce({ perishable: false, serialized: false, has_variants: true, sku: 'SKU1' } as any)
    // product-grain guard: no product base -> staged null -> guard returns without a lookup.
    // variant-grain + sub-variant-grain guards each read their live base unit:
    mQueryOne.mockResolvedValueOnce({ unit: 'box', factor: '1', dimension: 'count', qty_step: '1', display_label: 'Box' } as any) // v1
    mQueryOne.mockResolvedValueOnce({ unit: 'strip', factor: '1', dimension: 'count', qty_step: '1', display_label: null } as any) // sv1
    mAssertUnit.mockResolvedValue(null as any) // both allowed
    const res = await publishProductDraft('p1').catch(e => e)
    expect(res).not.toBeInstanceOf(UnitChangeBlockedError)
    // guard ran for both the variant and the sub-variant scope
    expect(mAssertUnit).toHaveBeenCalledTimes(2)
    const scopes = mAssertUnit.mock.calls.map(c => (c[1] as any))
    expect(scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: 'v1', subVariantId: null, label: 'Box' }),
        expect.objectContaining({ variantId: null, subVariantId: 'sv1', label: 'strip' }),
      ])
    )
  })
})
