import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getSiteControls: vi.fn().mockResolvedValue({ media: null }),
}))

import {
  loadProductMedia,
  loadProductMediaMany,
  getMediaLimits,
  applyProductMediaTx,
  syncLegacyImagesToMedia,
  syncLegacyImagesToMediaSafe,
  loadProductFaqs,
  applyProductFaqsTx,
  DEFAULT_MEDIA_LIMITS,
} from '@/lib/catalog/product-media'
import { getSiteControls } from '@/lib/catalog/site-controls'

const PID = '11111111-1111-1111-1111-111111111111'
const MID = '22222222-2222-2222-2222-222222222222'
const VID = '33333333-3333-3333-3333-333333333333'

/** Fake Db that records every call and returns queued rows in order. */
function fakeDb(...responses: any[][]) {
  let i = 0
  const calls: { sql: string; params: any[] }[] = []
  return {
    calls,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return { rows: responses[i++] ?? [] }
    }),
  }
}

describe('loadProductMedia', () => {
  it('filters to ready + effective scopes by default', async () => {
    const db = fakeDb([{ id: MID }])
    const rows = await loadProductMedia(PID, { db })
    expect(rows).toEqual([{ id: MID }])
    const sql = db.calls[0].sql
    expect(sql).toContain('m.root_product_id = $1')
    expect(sql).toContain(`m.status = 'ready'`)
    expect(sql).toContain('use_own_images')
    expect(db.calls[0].params).toEqual([PID])
  })

  it('drops the ready/effective filter when raw', async () => {
    const db = fakeDb([])
    await loadProductMedia(PID, { db, raw: true })
    const sql = db.calls[0].sql
    expect(sql).not.toContain(`m.status = 'ready'`)
  })
})

describe('loadProductMediaMany', () => {
  it('returns an empty map with no query for no ids', async () => {
    const db = fakeDb()
    const out = await loadProductMediaMany([], db)
    expect(out.size).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('groups rows by root_product_id', async () => {
    const db = fakeDb([
      { root_product_id: PID, id: 'a' },
      { root_product_id: PID, id: 'b' },
      { root_product_id: 'other', id: 'c' },
    ])
    const out = await loadProductMediaMany([PID, 'other'], db)
    expect(out.get(PID)!.map((m: any) => m.id)).toEqual(['a', 'b'])
    expect(out.get('other')!.map((m: any) => m.id)).toEqual(['c'])
    // root_product_id stripped from the item
    expect(out.get(PID)![0]).not.toHaveProperty('root_product_id')
    expect(db.calls[0].params).toEqual([[PID, 'other']])
  })
})

describe('getMediaLimits', () => {
  beforeEach(() => vi.mocked(getSiteControls).mockReset())

  it('returns site controls media when present', async () => {
    const custom = { ...DEFAULT_MEDIA_LIMITS, maxPerScope: 99 }
    vi.mocked(getSiteControls).mockResolvedValue({ media: custom } as any)
    expect(await getMediaLimits()).toBe(custom)
  })

  it('falls back to defaults when media is absent', async () => {
    vi.mocked(getSiteControls).mockResolvedValue({ media: null } as any)
    expect(await getMediaLimits()).toBe(DEFAULT_MEDIA_LIMITS)
  })

  it('falls back to defaults when site controls throw', async () => {
    vi.mocked(getSiteControls).mockImplementationOnce(() => Promise.reject(new Error('x')))
    await expect(getMediaLimits()).resolves.toBe(DEFAULT_MEDIA_LIMITS)
  })
})

describe('applyProductMediaTx', () => {
  it('applies sub switches, filters items by ownership, then deletes/updates/inserts and writes legacy', async () => {
    // Responses: variants select, (sub update), subs select, then delete/update/insert for media,
    // then set_config + 2x(delete/update/update/insert) for legacy tables + reset config.
    const db = fakeDb(
      [{ id: VID, use_own_images: true }], // variants
      [], // sub-variant update
      [{ id: 'sv-on', use_own_media: true }] // subs
    )
    const staged = {
      own_sub: { '55555555-5555-5555-5555-555555555555': true, 'not-a-uuid': true },
      items: [
        { id: MID, kind: 'image', url: 'https://cdn/a.jpg?x=1' }, // product-scope, kept
        { id: MID, kind: 'image', url: 'https://cdn/dup.jpg' }, // dup id dropped
        { id: '44444444-4444-4444-4444-444444444444', kind: 'image', url: 'https://cdn/b.jpg', variant_id: 'other-variant' }, // variant not own -> dropped
        { id: 'bad', kind: 'image', url: 'https://cdn/c.jpg' }, // bad id -> dropped
      ],
    }
    await applyProductMediaTx(db as any, PID, staged as any)

    const sqls = db.calls.map(c => c.sql)
    // sub switch update issued (valid uuid only)
    expect(sqls.some(s => s.includes('UPDATE product_sub_variants SET use_own_media'))).toBe(true)
    // delete-not-in then update then insert of product_media
    const del = db.calls.find(c => c.sql.includes('DELETE FROM product_media WHERE root_product_id'))!
    expect(del.params[0]).toBe(PID)
    expect(del.params[1]).toEqual([MID]) // only the kept item id
    // the staged JSON passed to update/insert contains exactly one normalized item
    const upd = db.calls.find(c => c.sql.includes('UPDATE product_media m SET'))!
    const items = JSON.parse(upd.params[1])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: MID, kind: 'image', product_id: PID, file_name: 'a.jpg' })
    // legacy mirror ran
    expect(sqls.some(s => s.includes("set_config('audit.skip', 'true'"))).toBe(true)
    expect(sqls.some(s => s.includes('FROM product_media m WHERE m.root_product_id = $1'))).toBe(true)
  })

  it('treats a non-array items list as empty', async () => {
    const db = fakeDb([], [])
    await applyProductMediaTx(db as any, PID, { items: null } as any)
    const del = db.calls.find(c => c.sql.includes('DELETE FROM product_media WHERE root_product_id'))!
    expect(del.params[1]).toEqual([])
  })
})

describe('syncLegacyImagesToMedia', () => {
  it('prunes orphans then upserts from product_images and variant_images', async () => {
    const db = fakeDb()
    await syncLegacyImagesToMedia(PID, db as any)
    const sqls = db.calls.map(c => c.sql)
    expect(sqls[0]).toContain('DELETE FROM product_media m')
    expect(sqls[1]).toContain('FROM product_images i WHERE i.product_id = $1')
    expect(sqls[2]).toContain('FROM variant_images vi')
    expect(sqls[1]).toContain('ON CONFLICT (id) DO UPDATE')
    for (const c of db.calls) expect(c.params).toEqual([PID])
  })
})

describe('syncLegacyImagesToMediaSafe', () => {
  it('swallows errors from the sync', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { query: vi.fn().mockImplementationOnce(() => Promise.reject(new Error('boom'))) }
    await expect(syncLegacyImagesToMediaSafe(PID, db as any)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('loadProductFaqs', () => {
  it('loads all faqs by default', async () => {
    const db = fakeDb([{ id: 'f1', question: 'q', answer: 'a' }])
    const out = await loadProductFaqs(PID, { db })
    expect(out).toHaveLength(1)
    expect(db.calls[0].sql).not.toContain('AND published')
    expect(db.calls[0].params).toEqual([PID])
  })

  it('restricts to published when asked', async () => {
    const db = fakeDb([])
    await loadProductFaqs(PID, { db, publishedOnly: true })
    expect(db.calls[0].sql).toContain('AND published')
  })
})

describe('applyProductFaqsTx', () => {
  it('ignores a non-array payload', async () => {
    const db = fakeDb()
    await applyProductFaqsTx(db as any, PID, 'nope')
    expect(db.query).not.toHaveBeenCalled()
  })

  it('normalizes rows (trim, order, published default) and issues delete/update/insert', async () => {
    const db = fakeDb()
    await applyProductFaqsTx(db as any, PID, [
      { id: MID, question: ' Q1 ', answer: ' A1 ', published: false },
      { question: 'Q2', answer: 'A2' },
      { question: '', answer: 'skip' }, // dropped (no question)
    ])
    const del = db.calls[0]
    expect(del.sql).toContain('DELETE FROM product_faqs WHERE product_id = $1')
    expect(del.params[1]).toEqual([MID]) // only known ids
    const insert = db.calls.find(c => c.sql.includes('INSERT INTO product_faqs'))!
    const rows = JSON.parse(insert.params[1])
    expect(rows).toEqual([
      { id: MID, question: 'Q1', answer: 'A1', sort_order: 0, published: false },
      { id: null, question: 'Q2', answer: 'A2', sort_order: 1, published: true },
    ])
  })
})
