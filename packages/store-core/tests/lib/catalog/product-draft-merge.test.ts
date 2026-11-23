import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keep project/threeWayMerge REAL (pure logic); mock only the revision DB helpers and the
// conflict-error class marker. DraftConflictError stays a real throwable.
vi.mock('@/lib/admin/entity-revisions', () => ({
  revisionsSince: vi.fn(),
  lastTouch: vi.fn(),
}))

import {
  liveProductSnapshot,
  mergeProductDraft,
  PRODUCT_SNAPSHOT_SELECT,
  PRODUCT_SETS,
  type ProductSnapshot,
} from '@/lib/catalog/product-draft-merge'
import { DraftConflictError } from '@/lib/admin/draft-branches'
import { revisionsSince, lastTouch } from '@/lib/admin/entity-revisions'

const mRevSince = vi.mocked(revisionsSince)
const mLastTouch = vi.mocked(lastTouch)

function snap(over: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { fields: {}, variants: [], images: [], sub_variants: [], units: [], variant_images: [], ...over }
}

const db = { query: vi.fn() }

beforeEach(() => vi.clearAllMocks())

describe('liveProductSnapshot', () => {
  it('runs the snapshot select and returns the first row', async () => {
    const row = snap({ fields: { base_price: 10 } })
    db.query.mockResolvedValueOnce({ rows: [row] })
    const r = await liveProductSnapshot(db as any, 'p1')
    expect(r).toBe(row)
    expect(db.query).toHaveBeenCalledWith(PRODUCT_SNAPSHOT_SELECT, ['p1'])
  })

  it('returns null when there is no row', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })
    expect(await liveProductSnapshot(db as any, 'p1')).toBeNull()
  })
})

describe('mergeProductDraft — no base (publish as-is)', () => {
  it('returns the draft unchanged with fingerprinted before/after', async () => {
    const draft = { ...snap({ fields: { base_price: 5 }, variants: [{ variant_name: 'V' }] }), product_id: 'p1', base: null }
    const live = snap({ fields: { base_price: 9 } })
    const r = await mergeProductDraft(db as any, draft as any, live)
    expect(r.merged).toBe(draft)
    // before is the live projected to the draft's keys, fingerprinted; after is mine fingerprinted.
    // variants set becomes a "count · hash" string in the fingerprint.
    expect(typeof r.after.variants).toBe('string')
    expect(r.after.variants).toMatch(/^1 · [0-9a-f]{10}$/)
    expect(r.after.base_price).toBe(5)
    expect(mRevSince).not.toHaveBeenCalled()
  })
})

describe('mergeProductDraft — clean three-way merge', () => {
  it('merges non-overlapping field edits and set changes', async () => {
    const base = snap({ fields: { base_price: 10, mrp: 20 } })
    const draft = { ...snap({ fields: { base_price: 15, mrp: 20 } }), product_id: 'p1', base, base_revision: 3 }
    // live changed a different field (mrp) than the draft (base_price): no conflict
    const live = snap({ fields: { base_price: 10, mrp: 25 } })
    const r = await mergeProductDraft(db as any, draft as any, live)
    expect(r.merged.fields.base_price).toBe(15) // mine
    expect(r.merged.fields.mrp).toBe(25) // theirs
    expect(mRevSince).not.toHaveBeenCalled()
  })

  it('passes draft-only (and _-prefixed) fields through untouched', async () => {
    const base = snap({ fields: { base_price: 10 } })
    const draft = {
      ...snap({ fields: { base_price: 10, _uiState: 'x', only_mine: 'keep' } }),
      product_id: 'p1',
      base,
      base_revision: 1,
    }
    const live = snap({ fields: { base_price: 10 } })
    const r = await mergeProductDraft(db as any, draft as any, live)
    expect(r.merged.fields._uiState).toBe('x')
    expect(r.merged.fields.only_mine).toBe('keep')
  })

  it('carries each PRODUCT_SET from the merge result onto merged', async () => {
    const base = snap({ variants: [{ variant_name: 'A' }] })
    const draft = { ...snap({ variants: [{ variant_name: 'A' }, { variant_name: 'B' }] }), product_id: 'p1', base, base_revision: 1 }
    const live = snap({ variants: [{ variant_name: 'A' }] })
    const r = await mergeProductDraft(db as any, draft as any, live)
    expect(r.merged.variants).toEqual([{ variant_name: 'A' }, { variant_name: 'B' }])
    expect(PRODUCT_SETS).toContain('variants')
  })
})

describe('mergeProductDraft — conflicts', () => {
  it('throws DraftConflictError with per-path attribution, describing set conflicts', async () => {
    const base = snap({ fields: { base_price: 10 }, variants: [{ variant_name: 'A' }] })
    // both sides edited base_price differently -> field conflict; both changed variants -> set conflict
    const draft = {
      ...snap({ fields: { base_price: 15 }, variants: [{ variant_name: 'A' }, { variant_name: 'Mine' }] }),
      product_id: 'p1',
      base,
      base_revision: 2,
    }
    const live = snap({ fields: { base_price: 99 }, variants: [{ variant_name: 'A' }, { variant_name: 'Theirs' }] })
    mRevSince.mockResolvedValueOnce([{ revision: 7, actor_name: 'Carol', source: 'publish', created_at: 'now' } as any])
    mLastTouch.mockReturnValue({ actor_name: 'Carol', source: 'publish', created_at: 'now' } as any)

    let caught: DraftConflictError | null = null
    try {
      await mergeProductDraft(db as any, draft as any, live)
    } catch (e) {
      caught = e as DraftConflictError
    }
    expect(caught).toBeInstanceOf(DraftConflictError)
    expect(mRevSince).toHaveBeenCalledWith(db, 'product', 'p1', 2)
    const conflicts = (caught as any).conflicts as any[]
    const variantsC = conflicts.find(c => c.path === 'variants')
    // set conflict paths get human descriptions
    expect(typeof variantsC.base).toBe('string')
    expect(variantsC.base).toContain('variant')
    expect(variantsC.theirsBy).toBe('Carol')
    expect(variantsC.theirsAt).toBe('now')
  })

  it('labels unknown-source touches and missing touches', async () => {
    const base = snap({ fields: { base_price: 10 } })
    const draft = { ...snap({ fields: { base_price: 15 } }), product_id: 'p1', base, base_revision: 0 }
    const live = snap({ fields: { base_price: 20 } })
    mRevSince.mockResolvedValueOnce([])
    mLastTouch.mockReturnValueOnce(null) // no touch -> "a change outside drafts"
    let caught: any = null
    try {
      await mergeProductDraft(db as any, draft as any, live)
    } catch (e) {
      caught = e
    }
    const c = caught.conflicts.find((x: any) => x.path === 'base_price')
    expect(c.theirsBy).toBe('a change outside drafts')
    expect(c.theirsAt).toBeNull()
    // revision falls back to base_revision (0) when revs is empty
    expect(caught.liveRevision).toBe(0)
  })

  it('describes a non-publish source touch without an actor name', async () => {
    const base = snap({ fields: { base_price: 10 } })
    const draft = { ...snap({ fields: { base_price: 15 } }), product_id: 'p1', base, base_revision: 1 }
    const live = snap({ fields: { base_price: 20 } })
    mRevSince.mockResolvedValueOnce([{ revision: 4 } as any])
    mLastTouch.mockReturnValueOnce({ actor_name: null, source: 'import', created_at: 't2' } as any)
    let caught: any = null
    try {
      await mergeProductDraft(db as any, draft as any, live)
    } catch (e) {
      caught = e
    }
    const c = caught.conflicts.find((x: any) => x.path === 'base_price')
    expect(c.theirsBy).toBe('a import change')
    expect(caught.liveRevision).toBe(4)
  })

  it('resolutions clear the conflict so the merge succeeds', async () => {
    const base = snap({ fields: { base_price: 10 } })
    const draft = { ...snap({ fields: { base_price: 15 } }), product_id: 'p1', base, base_revision: 1 }
    const live = snap({ fields: { base_price: 20 } })
    const r = await mergeProductDraft(db as any, draft as any, live, { base_price: 'theirs' })
    expect(r.merged.fields.base_price).toBe(20)
    expect(mRevSince).not.toHaveBeenCalled()
  })
})
