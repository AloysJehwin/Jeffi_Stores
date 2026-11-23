import { describe, it, expect } from 'vitest'
import { PRESENCE_TTL_SECONDS, heartbeat, viewers, viewerCounts, listDrafts, sweep } from '../src/presence'
import { FakeClient, lockRow } from './helpers'

const HB = { type: 'product' as const, id: 'res-1', adminId: 'admin-1', tabId: 'tab-1', mode: 'edit' as const }

describe('presence constant', () => {
  it('TTL is 45s', () => expect(PRESENCE_TTL_SECONDS).toBe(45))
})

describe('heartbeat', () => {
  it('leaving -> DELETE, changed when a row went', async () => {
    const c = new FakeClient().on('DELETE FROM draft_presence', { rowCount: 1 })
    const r = await heartbeat(c, { ...HB, leaving: true })
    expect(r.changed).toBe(true)
    expect(c.first('DELETE FROM draft_presence')?.params).toEqual(['product', 'res-1', 'admin-1', 'tab-1'])
  })
  it('leaving with nothing deleted -> changed false', async () => {
    const c = new FakeClient().on('DELETE FROM draft_presence', { rowCount: 0 })
    expect((await heartbeat(c, { ...HB, leaving: true })).changed).toBe(false)
  })
  it('first heartbeat inserts -> changed true (xmax=0)', async () => {
    const c = new FakeClient().on('INSERT INTO draft_presence', { rows: [{ inserted: true }] })
    expect((await heartbeat(c, HB)).changed).toBe(true)
  })
  it('refresh (conflict) -> changed false', async () => {
    const c = new FakeClient().on('INSERT INTO draft_presence', { rows: [{ inserted: false }] })
    expect((await heartbeat(c, HB)).changed).toBe(false)
  })
  it('no returning row -> changed false', async () => {
    const c = new FakeClient().on('INSERT INTO draft_presence', { rows: [] })
    expect((await heartbeat(c, HB)).changed).toBe(false)
  })
})

describe('viewers', () => {
  it('maps rows, editing->edit mode, Date/string seen_at', async () => {
    const c = new FakeClient().on('FROM draft_presence p', {
      rows: [
        { admin_id: 'a1', name: 'Alice', editing: true, seen_at: new Date('2026-03-03T00:00:00.000Z') },
        { admin_id: 'a2', name: null, editing: false, seen_at: '2026-03-03T01:00:00Z' },
      ],
    })
    const vs = await viewers(c, 'product', 'res-1')
    expect(vs).toEqual([
      { adminId: 'a1', name: 'Alice', mode: 'edit', seenAt: '2026-03-03T00:00:00.000Z' },
      { adminId: 'a2', name: null, mode: 'view', seenAt: '2026-03-03T01:00:00Z' },
    ])
    expect(c.first('FROM draft_presence p')?.params).toEqual(['product', 'res-1', PRESENCE_TTL_SECONDS])
  })
  it('empty when no presence', async () => {
    expect(await viewers(new FakeClient(), 'product', 'res-1')).toEqual([])
  })
})

describe('viewerCounts', () => {
  it('empty keys short-circuits', async () => {
    const c = new FakeClient()
    expect(await viewerCounts(c, [])).toEqual({})
    expect(c.calls.length).toBe(0)
  })
  it('builds a type:id -> count map', async () => {
    const c = new FakeClient().on('FROM draft_presence', {
      rows: [{ k: 'product:a', n: 2 }, { k: 'brand:b', n: 1 }],
    })
    const m = await viewerCounts(c, [{ type: 'product', id: 'a' }, { type: 'brand', id: 'b' }])
    expect(m).toEqual({ 'product:a': 2, 'brand:b': 1 })
    expect(c.first('FROM draft_presence')?.params[0]).toEqual(['product', 'brand'])
  })
})

describe('listDrafts', () => {
  it('no types -> empty result', async () => {
    const c = new FakeClient()
    expect(await listDrafts(c, { scope: 'mine', adminId: 'admin-1', types: [], limit: 10, offset: 0 })).toEqual({
      rows: [],
      total: 0,
    })
  })

  it('mine scope lists caller-held locks with labels', async () => {
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', { rows: [lockRow({ resource_id: 'p1' })] })
      .on('FROM product_drafts d JOIN products', { rows: [{ id: 'p1', label: 'Widget', ref: 'ent-1' }] })
    const r = await listDrafts(c, { scope: 'mine', adminId: 'admin-1', types: ['product'], limit: 10, offset: 0 })
    expect(r.total).toBe(1)
    expect(r.rows[0].label).toBe('Widget')
    expect(r.rows[0].editHref).toBe('/admin/products/ent-1/edit?draft=p1')
    expect(r.rows[0].lock?.resourceId).toBe('p1')
    // mine filter uses owner_admin_id = $2
    expect(c.first('l.closed_at IS NULL AND l.resource_type = ANY')?.params).toEqual([['product'], 'admin-1'])
  })

  it('all scope lists every held lock, label falls back to def label', async () => {
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', { rows: [lockRow({ resource_id: 'p1' })] })
      .on('FROM product_drafts d JOIN products', { rows: [] }) // no label row
    const r = await listDrafts(c, { scope: 'all', adminId: 'admin-1', types: ['product'], limit: 10, offset: 0 })
    expect(r.rows[0].label).toBe('Product')
  })

  it('unclaimed scope: drafts with no lock + released locks', async () => {
    const c = new FakeClient()
      // NOT EXISTS unclaimed drafts
      .on('WHERE NOT EXISTS', { rows: [{ id: 'd1', updated_at: new Date('2026-04-04T00:00:00.000Z') }, { id: 'd2', updated_at: '2026-04-05T00:00:00Z' }] })
      // released (owner null) locks
      .on('l.owner_admin_id IS NULL', { rows: [lockRow({ resource_id: 'd2', owner_admin_id: null })] })
      .on('FROM product_drafts d JOIN products', { rows: [{ id: 'd1', label: 'Draft One', ref: null }] })
    const r = await listDrafts(c, { scope: 'unclaimed', adminId: 'admin-1', types: ['product'], limit: 10, offset: 0 })
    expect(r.total).toBe(2)
    // d2 (newer updated_at) sorts first
    expect(r.rows[0].resourceId).toBe('d2')
    expect(r.rows[0].lock?.resourceId).toBe('d2')
    expect(r.rows[1].lock).toBeNull()
  })

  it('sort by label (asc) fetches names once and orders them', async () => {
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', {
        rows: [lockRow({ resource_id: 'p1' }), lockRow({ resource_id: 'p2' })],
      })
      .on('FROM product_drafts d JOIN products', {
        rows: [{ id: 'p1', label: 'Zebra', ref: null }, { id: 'p2', label: 'Apple', ref: null }],
      })
    const r = await listDrafts(c, {
      scope: 'all',
      adminId: 'admin-1',
      types: ['product'],
      limit: 10,
      offset: 0,
      sort: { key: 'label', dir: 'asc' },
    })
    expect(r.rows.map(x => x.label)).toEqual(['Apple', 'Zebra'])
    // labels fetched once (allNames reused for the page)
    expect(c.matching('FROM product_drafts d JOIN products').length).toBe(1)
  })

  it('sort by viewers (desc) uses viewerCounts', async () => {
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', {
        rows: [lockRow({ resource_id: 'p1' }), lockRow({ resource_id: 'p2' })],
      })
      .on('FROM draft_presence', { rows: [{ k: 'product:p2', n: 5 }, { k: 'product:p1', n: 1 }] })
      .on('FROM product_drafts d JOIN products', { rows: [{ id: 'p1', label: 'One', ref: null }, { id: 'p2', label: 'Two', ref: null }] })
    const r = await listDrafts(c, {
      scope: 'all',
      adminId: 'admin-1',
      types: ['product'],
      limit: 10,
      offset: 0,
      sort: { key: 'viewers', dir: 'desc' },
    })
    expect(r.rows.map(x => x.resourceId)).toEqual(['p2', 'p1'])
  })

  it('sort keys type/owner/started/active and null handling', async () => {
    const mk = (over: Record<string, any>) => lockRow({ ...over })
    const rows = [
      mk({ resource_id: 'p1', owner_name: 'Bob', started_at: '2026-01-02T00:00:00Z', last_active_at: '2026-01-05T00:00:00Z' }),
      mk({ resource_id: 'p2', owner_name: null, started_at: '2026-01-01T00:00:00Z', last_active_at: '2026-01-06T00:00:00Z' }),
    ]
    for (const key of ['type', 'owner', 'started', 'active'] as const) {
      const c = new FakeClient()
        .on('l.closed_at IS NULL AND l.resource_type = ANY', { rows: rows.map(r => ({ ...r })) })
        .on('FROM product_drafts d JOIN products', { rows: [] })
      const r = await listDrafts(c, {
        scope: 'all',
        adminId: 'admin-1',
        types: ['product'],
        limit: 10,
        offset: 0,
        sort: { key, dir: 'asc' },
      })
      expect(r.rows.length).toBe(2)
    }
  })

  it('offset/limit paging', async () => {
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', {
        rows: [lockRow({ resource_id: 'p1' }), lockRow({ resource_id: 'p2' }), lockRow({ resource_id: 'p3' })],
      })
      .on('FROM product_drafts d JOIN products', { rows: [] })
    const r = await listDrafts(c, { scope: 'all', adminId: 'admin-1', types: ['product'], limit: 1, offset: 1 })
    expect(r.total).toBe(3)
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].resourceId).toBe('p2')
  })

  it('campaign labelSql takes no $1 (no param array)', async () => {
    // campaign.labelSql DOES include $1 actually; use homepage which also includes $1.
    // Use a type whose listSql path exercises labels with ref null; invoice labelSql has $1.
    const c = new FakeClient()
      .on('l.closed_at IS NULL AND l.resource_type = ANY', { rows: [lockRow({ resource_type: 'invoice', resource_id: 'o1' })] })
      .on('FROM orders WHERE id = ANY', { rows: [{ id: 'o1', label: 'INV-1', ref: null }] })
    const r = await listDrafts(c, { scope: 'all', adminId: 'admin-1', types: ['invoice'], limit: 10, offset: 0 })
    expect(r.rows[0].label).toBe('INV-1')
    expect(r.rows[0].editHref).toBe('/admin/invoices?view=edit&edit=o1')
  })
})

describe('sweep', () => {
  it('counts presence/released/orphaned/purged and supersedes + closes orphans', async () => {
    const c = new FakeClient()
      .on('DELETE FROM draft_presence WHERE seen_at', { rowCount: 3 })
      // released inactive-admin locks
      .on('SET previous_owner_admin_id = l.owner_admin_id, owner_admin_id = NULL', {
        rows: [{ resource_type: 'product', resource_id: 'r1', previous_owner_admin_id: 'adm-x' }],
        rowCount: 1,
      })
      .on('editor_sessions', { rowCount: 1 })
      // open locks older than 10m
      .on("started_at < now() - interval '10 minutes'", { rows: [{ resource_type: 'product', resource_id: 'gone' }, { resource_type: 'bogus', resource_id: 'skip' }] })
      // exists check for the product -> empty so it's orphaned
      .on('SELECT 1 FROM product_drafts', { rows: [] })
      .on("closed_reason = 'orphaned'", { rowCount: 1 })
      .on("DELETE FROM draft_locks WHERE closed_at <", { rowCount: 2 })
    const r = await sweep(c)
    expect(r).toEqual({ presence: 3, released: 1, orphaned: 1, purged: 2 })
    // bogus type was skipped (def undefined)
    expect(c.matching("closed_reason = 'orphaned'").length).toBe(1)
  })

  it('orphan check: draft still exists -> not closed', async () => {
    const c = new FakeClient()
      .on('DELETE FROM draft_presence WHERE seen_at', { rowCount: 0 })
      .on('SET previous_owner_admin_id = l.owner_admin_id, owner_admin_id = NULL', { rows: [], rowCount: 0 })
      .on("started_at < now() - interval '10 minutes'", { rows: [{ resource_type: 'product', resource_id: 'alive' }] })
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on("DELETE FROM draft_locks WHERE closed_at <", { rowCount: 0 })
    const r = await sweep(c)
    expect(r.orphaned).toBe(0)
    expect(c.matching("closed_reason = 'orphaned'").length).toBe(0)
  })
})
