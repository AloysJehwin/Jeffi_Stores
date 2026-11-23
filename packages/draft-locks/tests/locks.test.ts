import { describe, it, expect } from 'vitest'
import {
  q,
  defaultHasScope,
  toLock,
  DraftLockError,
  isDraftLockError,
  getLock,
  draftExists,
  acquire,
  assertHolder,
  close,
  release,
  handover,
  takeover,
  status,
  lockMap,
  changedSince,
  releaseLocksOfAdmin,
  dropLocksFor,
} from '../src/locks'
import { FakeClient, lockRow } from './helpers'

const ACTOR = { adminId: 'admin-1', role: 'administrator', scopes: [] as string[] }

describe('q (result normaliser)', () => {
  it('normalises missing rows/rowCount', async () => {
    const r = await q({ query: async () => ({}) as any }, 'X')
    expect(r).toEqual({ rows: [], rowCount: 0 })
  })
  it('passes rows + rowCount through', async () => {
    const r = await q({ query: async () => ({ rows: [{ a: 1 }], rowCount: 1 }) }, 'X', [1])
    expect(r.rows).toEqual([{ a: 1 }])
    expect(r.rowCount).toBe(1)
  })
})

describe('defaultHasScope', () => {
  it('administrator always passes', () => expect(defaultHasScope('administrator', [], 'x:write')).toBe(true))
  it('scope membership passes', () => expect(defaultHasScope('manager', ['x:write'], 'x:write')).toBe(true))
  it('otherwise fails', () => expect(defaultHasScope('manager', ['y:read'], 'x:write')).toBe(false))
})

describe('toLock', () => {
  it('maps a full row and derives ownerCanEdit (administrator)', () => {
    const l = toLock(lockRow({ owner_role: 'administrator', owner_active: true }))
    expect(l.ownerId).toBe('admin-1')
    expect(l.ownerActive).toBe(true)
    expect(l.ownerCanEdit).toBe(true)
    expect(l.epoch).toBe(1)
    expect(l.startedAt).toBe('2026-01-01T00:00:00.000Z')
  })
  it('ownerCanEdit false when inactive', () => {
    expect(toLock(lockRow({ owner_active: false })).ownerCanEdit).toBe(false)
  })
  it('ownerCanEdit false with no owner', () => {
    expect(toLock(lockRow({ owner_admin_id: null })).ownerCanEdit).toBe(false)
  })
  it('ownerCanEdit false when role lacks scope', () => {
    expect(toLock(lockRow({ owner_role: 'viewer', owner_scopes: ['foo'] })).ownerCanEdit).toBe(false)
  })
  it('ownerCanEdit true when scope present (non-admin)', () => {
    expect(toLock(lockRow({ owner_role: 'manager', owner_scopes: ['products:write'] })).ownerCanEdit).toBe(true)
  })
  it('ownerCanEdit false for unknown resource type', () => {
    expect(toLock(lockRow({ resource_type: 'bogus' as any })).ownerCanEdit).toBe(false)
  })
  it('converts Date fields to ISO and nulls', () => {
    const d = new Date('2026-05-05T10:00:00.000Z')
    const l = toLock(lockRow({ started_at: d, closed_at: null, epoch: 'NaNish' }))
    expect(l.startedAt).toBe('2026-05-05T10:00:00.000Z')
    expect(l.closedAt).toBeNull()
    expect(l.epoch).toBe(0) // Number('NaNish') || 0
  })
  it('null-ish defaults', () => {
    const l = toLock({ resource_type: 'product', resource_id: 'r', owner_admin_id: null })
    expect(l.ownerName).toBeNull()
    expect(l.startedById).toBeNull()
    expect(l.closedReason).toBeNull()
    expect(l.startedAt).toBe('') // iso(undefined) -> ''
  })
  it('scopesOf coerces non-array to empty', () => {
    // owner_scopes not an array -> treated as [] -> non-admin cannot edit
    expect(toLock(lockRow({ owner_role: 'manager', owner_scopes: 'products:write' })).ownerCanEdit).toBe(false)
  })
})

describe('DraftLockError', () => {
  it('default DRAFT_LOCKED message uses owner name', () => {
    const l = toLock(lockRow({ owner_name: 'Alice' }))
    const e = new DraftLockError('DRAFT_LOCKED', l)
    expect(e.status).toBe(423)
    expect(e.message).toContain('Alice')
    expect(e.body().code).toBe('DRAFT_LOCKED')
    expect(e.body().lock?.ownerName).toBe('Alice')
  })
  it('DRAFT_LOCKED fallback when no lock', () => {
    expect(new DraftLockError('DRAFT_LOCKED', null).message).toContain('Another admin')
  })
  it('DRAFT_LOCK_STALE default message', () => {
    expect(new DraftLockError('DRAFT_LOCK_STALE', null).message).toContain('changed hands')
  })
  it('custom message override', () => {
    expect(new DraftLockError('DRAFT_LOCKED', null, 'custom').message).toBe('custom')
  })
  it('body() lock is null when no lock', () => {
    expect(new DraftLockError('DRAFT_LOCK_STALE', null).body().lock).toBeFalsy()
  })
  it('isDraftLockError duck-types by name', () => {
    expect(isDraftLockError(new DraftLockError('DRAFT_LOCKED', null))).toBe(true)
    expect(isDraftLockError({ name: 'DraftLockError' })).toBe(true)
    expect(isDraftLockError(new Error('x'))).toBe(false)
    expect(isDraftLockError(null)).toBe(false)
    expect(isDraftLockError('str')).toBe(false)
  })
})

describe('getLock / draftExists', () => {
  it('getLock returns a lock when a row exists', async () => {
    const c = new FakeClient().on('FROM draft_locks l', { rows: [lockRow()] })
    const l = await getLock(c, 'product', 'res-1')
    expect(l?.ownerId).toBe('admin-1')
  })
  it('getLock returns null when no row', async () => {
    const c = new FakeClient()
    expect(await getLock(c, 'product', 'res-1')).toBeNull()
  })
  it('getLock ignores a row without resource_type (empty join artifact)', async () => {
    const c = new FakeClient().on('FROM draft_locks l', { rows: [{ owner_admin_id: null }] })
    expect(await getLock(c, 'product', 'res-1')).toBeNull()
  })
  it('draftExists true/false and $1 param passing', async () => {
    const c = new FakeClient().on('SELECT 1 FROM product_drafts', { rows: [{ '?column?': 1 }] })
    expect(await draftExists(c, 'product', 'id-x')).toBe(true)
    expect(c.first('SELECT 1 FROM product_drafts')?.params).toEqual(['id-x'])
    const c2 = new FakeClient()
    expect(await draftExists(c2, 'product', 'id-x')).toBe(false)
  })
})

describe('acquire', () => {
  it('inserts a fresh lock (no conflict) -> acquired/created', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [{ epoch: 0 }] })
      .on('FROM draft_locks l', { rows: [lockRow({ epoch: 0 })] })
    const res = await acquire(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
    expect(res.created).toBe(true)
    // via defaults to 'start'
    expect(c.first('INSERT INTO draft_locks')?.params[3]).toBe('start')
  })

  it('conflict + no current row + attempt<=1 recurses then throws STALE', async () => {
    // INSERT always conflicts (no rows); readRow always empty -> recursion to attempt 2 -> throw.
    const c = new FakeClient().on('INSERT INTO draft_locks', { rows: [] }).on('FOR UPDATE OF l', { rows: [] })
    await expect(acquire(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCK_STALE' })
  })

  it('reopens a closed lock -> acquired/created', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ closed_at: '2026-01-01T00:00:00Z', epoch: 3 })] })
      .on('SET owner_admin_id = $3, started_by_admin_id = $3', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ epoch: 4 })] })
    const res = await acquire(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
    expect(res.created).toBe(true)
    // fenced on the epoch read under FOR UPDATE
    expect(c.first('SET owner_admin_id = $3, started_by_admin_id = $3')?.params[4]).toBe(3)
  })

  it('reopen loses the epoch race -> STALE', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ closed_at: 'x', epoch: 3 })] })
      .on('SET owner_admin_id = $3, started_by_admin_id = $3', { rowCount: 0 })
    await expect(acquire(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCK_STALE' })
  })

  it('already the caller: refresh last_active, change null', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1' })] })
      .on('SET last_active_at = now() WHERE', { rowCount: 1 })
    const res = await acquire(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBeNull()
    expect(res.created).toBe(false)
    expect(res.lock?.ownerId).toBe('admin-1')
  })

  it('owner still holds (active + scope) -> DRAFT_LOCKED', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_role: 'administrator', owner_active: true })] })
    await expect(acquire(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' })
  })

  it('owner no longer holds (inactive) -> claim', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_active: false, epoch: 5 })] })
      .on("acquired_via = 'claim'", { rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: 'admin-1', acquired_via: 'claim' })] })
    const res = await acquire(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
    expect(res.previousOwnerId).toBe('other')
    expect(res.created).toBe(false)
  })

  it('claim loses epoch race -> STALE', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_active: false })] })
      .on("acquired_via = 'claim'", { rowCount: 0 })
    await expect(acquire(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCK_STALE' })
  })

  it('honours explicit via', async () => {
    const c = new FakeClient()
      .on('INSERT INTO draft_locks', { rows: [{ epoch: 0 }] })
      .on('FROM draft_locks l', { rows: [lockRow()] })
    await acquire(c, ACTOR, 'product', 'res-1', { via: 'backfill' })
    expect(c.first('INSERT INTO draft_locks')?.params[3]).toBe('backfill')
  })
})

describe('assertHolder', () => {
  it('fast path: holder update hits -> lock null, no change', async () => {
    const c = new FakeClient().on('SET last_active_at = now()\n      WHERE', { rows: [{ epoch: 2 }] })
    const res = await assertHolder(c, ACTOR, 'product', 'res-1')
    expect(res).toEqual({ lock: null, change: null })
  })

  it('no lock + draft gone -> lock null (nothing to guard)', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [] })
      .on('SELECT 1 FROM product_drafts', { rows: [] })
    const res = await assertHolder(c, ACTOR, 'product', 'res-1')
    expect(res).toEqual({ lock: null, change: null })
  })

  it('no lock + draft exists -> acquire via claim', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [] })
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('INSERT INTO draft_locks', { rows: [{ epoch: 0 }] })
      .on('FROM draft_locks l', { rows: [lockRow()] })
    const res = await assertHolder(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
  })

  it('closed lock + draft exists -> acquire via start', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ closed_at: 'x' })] }, 1)
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('INSERT INTO draft_locks', { rows: [] }) // conflict path inside acquire
      .on('FOR UPDATE OF l', { rows: [lockRow({ closed_at: 'x', epoch: 2 })] })
      .on('SET owner_admin_id = $3, started_by_admin_id = $3', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow()] })
    const res = await assertHolder(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
  })

  it('stale: caller thinks they hold but epoch differs (owner is them) -> STALE', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1' })] })
    await expect(assertHolder(c, ACTOR, 'product', 'res-1', { epoch: 9 })).rejects.toMatchObject({ code: 'DRAFT_LOCK_STALE' })
  })

  it('owner no longer holds, no epoch -> claim', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_active: false, epoch: 1 })] })
      .on("acquired_via = 'claim'", { rowCount: 1 })
      .on('editor_sessions', { rowCount: 0 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: 'admin-1' })] })
    const res = await assertHolder(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('acquired')
  })

  it('owner no longer holds but epoch set -> STALE (tab fenced)', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_active: false })] })
    await expect(assertHolder(c, ACTOR, 'product', 'res-1', { epoch: 2 })).rejects.toMatchObject({ code: 'DRAFT_LOCK_STALE' })
  })

  it('another admin holds firmly -> DRAFT_LOCKED', async () => {
    const c = new FakeClient()
      .on('SET last_active_at = now()\n      WHERE', { rows: [] })
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', owner_active: true, owner_role: 'administrator' })] })
    await expect(assertHolder(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' })
  })
})

describe('close', () => {
  it('closes an open lock', async () => {
    const c = new FakeClient()
      .on('SET closed_at = now(), closed_reason = $3', { rows: [{ epoch: 2 }], rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ closed_at: 'x', closed_reason: 'published' })] })
    const res = await close(c, ACTOR, 'product', 'res-1', 'published')
    expect(res.change).toBe('closed')
    expect(res.lock?.closedReason).toBe('published')
    expect(c.matching('INSERT INTO draft_locks').length).toBe(0) // no tombstone needed
  })

  it('no open lock + actor present -> inserts a tombstone', async () => {
    const c = new FakeClient()
      .on('SET closed_at = now(), closed_reason = $3', { rowCount: 0 })
      .on('INSERT INTO draft_locks', { rowCount: 1 })
      .on('editor_sessions', { rowCount: 0 })
      .on('FROM draft_locks l', { rows: [lockRow({ closed_at: 'x', closed_reason: 'discarded' })] })
    const res = await close(c, ACTOR, 'product', 'res-1', 'discarded')
    expect(res.change).toBe('closed')
    expect(c.matching('INSERT INTO draft_locks').length).toBe(1)
  })

  it('no open lock + no actor -> no tombstone', async () => {
    const c = new FakeClient()
      .on('SET closed_at = now(), closed_reason = $3', { rowCount: 0 })
      .on('editor_sessions', { rowCount: 0 })
    const res = await close(c, null, 'product', 'res-1', 'deleted')
    expect(res.change).toBe('closed')
    expect(c.matching('INSERT INTO draft_locks').length).toBe(0)
    expect(c.first('SET closed_at = now(), closed_reason = $3')?.params[3]).toBeNull()
  })
})

describe('release', () => {
  it('holder releases', async () => {
    const c = new FakeClient()
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1', epoch: 2 })] }, 1)
      .on('SET owner_admin_id = NULL, previous_owner_admin_id = $3', { rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: null })] })
    const res = await release(c, ACTOR, 'product', 'res-1')
    expect(res.change).toBe('released')
    expect(res.previousOwnerId).toBe('admin-1')
  })

  it('non-holder -> DRAFT_LOCKED (You do not hold this draft)', async () => {
    const c = new FakeClient().on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other' })] })
    await expect(release(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' })
  })

  it('no lock row -> DRAFT_LOCKED with null lock', async () => {
    const c = new FakeClient().on('FOR UPDATE OF l', { rows: [] })
    await expect(release(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCKED', lock: null })
  })

  it('closed lock -> DRAFT_LOCKED', async () => {
    const c = new FakeClient().on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1', closed_at: 'x' })] })
    await expect(release(c, ACTOR, 'product', 'res-1')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' })
  })
})

describe('handover', () => {
  it('owner hands off', async () => {
    const c = new FakeClient()
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1', epoch: 1 })] }, 1)
      .on("acquired_via = 'handover'", { rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: 'admin-2', acquired_via: 'handover' })] })
    const res = await handover(c, ACTOR, 'product', 'res-1', 'admin-2')
    expect(res.change).toBe('handover')
    expect(res.previousOwnerId).toBe('admin-1')
    expect(c.first("acquired_via = 'handover'")?.params[2]).toBe('admin-2')
  })

  it('non-holder -> DRAFT_LOCKED', async () => {
    const c = new FakeClient().on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other' })] })
    await expect(handover(c, ACTOR, 'product', 'res-1', 'admin-2')).rejects.toMatchObject({ code: 'DRAFT_LOCKED' })
  })
})

describe('takeover', () => {
  it('non-override role -> DRAFT_LOCKED (Only owners...)', async () => {
    const c = new FakeClient().on('FROM draft_locks l', { rows: [lockRow()] })
    await expect(takeover(c, { adminId: 'm', role: 'manager' }, 'product', 'res-1', 'why')).rejects.toMatchObject({
      code: 'DRAFT_LOCKED',
    })
  })

  it('no lock / closed / no owner -> acquire via claim', async () => {
    const c = new FakeClient()
      .on('FOR UPDATE OF l', { rows: [] }, 1)
      .on('INSERT INTO draft_locks', { rows: [{ epoch: 0 }] })
      .on('FROM draft_locks l', { rows: [lockRow()] })
    const res = await takeover(c, ACTOR, 'product', 'res-1', 'why')
    expect(res.change).toBe('acquired')
  })

  it('caller already owns -> change null', async () => {
    const c = new FakeClient().on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'admin-1' })] })
    const res = await takeover(c, ACTOR, 'product', 'res-1', 'why')
    expect(res.change).toBeNull()
    expect(res.lock?.ownerId).toBe('admin-1')
  })

  it('forces takeover from another admin with reason', async () => {
    const c = new FakeClient()
      .on('FOR UPDATE OF l', { rows: [lockRow({ owner_admin_id: 'other', epoch: 4 })] }, 1)
      .on("acquired_via = 'takeover'", { rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: 'admin-1', acquired_via: 'takeover', takeover_reason: 'why' })] })
    const res = await takeover(c, ACTOR, 'product', 'res-1', 'why')
    expect(res.change).toBe('takeover')
    expect(res.previousOwnerId).toBe('other')
    expect(c.first("acquired_via = 'takeover'")?.params[3]).toBe('why')
  })
})

describe('status', () => {
  it('existing lock, no hint lookup', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [lockRow()] })
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
    const s = await status(c, 'product', 'res-1')
    expect(s.lock?.ownerId).toBe('admin-1')
    expect(s.draftExists).toBe(true)
    expect(s.ownerHintId).toBeNull()
  })

  it('no lock, draft exists, hint admin can edit -> seeds a backfill lock', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [] }, 1) // first readRow: none
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('SELECT author_admin_id AS admin_id FROM product_drafts', { rows: [{ admin_id: 'hint-admin' }] })
      .on('SELECT role, scopes, is_active FROM admins', { rows: [{ role: 'administrator', scopes: [], is_active: true }] })
      .on('INSERT INTO draft_locks', { rowCount: 1 })
      .on('FROM draft_locks l', { rows: [lockRow({ owner_admin_id: 'hint-admin', acquired_via: 'backfill' })] })
    const s = await status(c, 'product', 'res-1')
    expect(s.ownerHintId).toBe('hint-admin')
    expect(s.lock?.ownerId).toBe('hint-admin')
    expect(c.matching('INSERT INTO draft_locks').length).toBe(1)
  })

  it('hint admin cannot edit (inactive) -> no backfill, lock null', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [] })
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('SELECT author_admin_id AS admin_id FROM product_drafts', { rows: [{ admin_id: 'hint-admin' }] })
      .on('SELECT role, scopes, is_active FROM admins', { rows: [{ role: 'administrator', scopes: [], is_active: false }] })
    const s = await status(c, 'product', 'res-1')
    expect(s.ownerHintId).toBe('hint-admin')
    expect(s.lock).toBeNull()
    expect(c.matching('INSERT INTO draft_locks').length).toBe(0)
  })

  it('hint returns no admin -> no backfill', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [] })
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('SELECT author_admin_id AS admin_id FROM product_drafts', { rows: [] })
    const s = await status(c, 'product', 'res-1')
    expect(s.ownerHintId).toBeNull()
    expect(c.matching('SELECT role, scopes, is_active').length).toBe(0)
  })

  it('type without hintSql (invoice) -> skips hint block', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [] })
      .on('SELECT 1 FROM orders', { rows: [{ x: 1 }] })
    const s = await status(c, 'invoice', 'res-1')
    expect(s.ownerHintId).toBeNull()
    expect(s.draftExists).toBe(true)
  })

  it('closed lock present + hint path still runs (row.closed_at)', async () => {
    const c = new FakeClient()
      .on('FROM draft_locks l', { rows: [lockRow({ closed_at: 'x' })] }) // row exists but closed
      .on('SELECT 1 FROM product_drafts', { rows: [{ x: 1 }] })
      .on('SELECT author_admin_id AS admin_id FROM product_drafts', { rows: [{ admin_id: 'hint-admin' }] })
    const s = await status(c, 'product', 'res-1')
    // row present so no backfill insert even though hint found
    expect(s.ownerHintId).toBe('hint-admin')
    expect(c.matching('INSERT INTO draft_locks').length).toBe(0)
  })
})

describe('lockMap', () => {
  it('empty ids short-circuits', async () => {
    const c = new FakeClient()
    expect(await lockMap(c, 'product', [])).toEqual({})
    expect(c.calls.length).toBe(0)
  })
  it('keys open locks by resource id', async () => {
    const c = new FakeClient().on('FROM draft_locks l', {
      rows: [lockRow({ resource_id: 'a' }), lockRow({ resource_id: 'b', owner_admin_id: 'admin-2' })],
    })
    const m = await lockMap(c, 'product', ['a', 'b'])
    expect(Object.keys(m)).toEqual(['a', 'b'])
    expect(m.b.ownerId).toBe('admin-2')
  })
})

describe('changedSince', () => {
  it('null cursor -> empty locks + now() cursor', async () => {
    const c = new FakeClient().on('SELECT now()::text AS now', { rows: [{ now: '2026-02-02T00:00:00Z' }] })
    const r = await changedSince(c, null)
    expect(r.locks).toEqual([])
    expect(r.cursor).toBe('2026-02-02T00:00:00Z')
  })
  it('null cursor with empty now row -> ISO fallback', async () => {
    const c = new FakeClient().on('SELECT now()::text AS now', { rows: [] })
    const r = await changedSince(c, null)
    expect(typeof r.cursor).toBe('string')
    expect(r.cursor.length).toBeGreaterThan(0)
  })
  it('returns changed locks and advances cursor to last row', async () => {
    const c = new FakeClient().on('LATERAL', {
      rows: [lockRow({ cursor_text: 't1' }), lockRow({ resource_id: 'r2', cursor_text: 't2' })],
    })
    const r = await changedSince(c, '2026-01-01T00:00:00Z', { limit: 50 })
    expect(r.locks.length).toBe(2)
    expect(r.cursor).toBe('t2')
    expect(c.first('LATERAL')?.params).toEqual(['2026-01-01T00:00:00Z', 50])
  })
  it('no changed rows -> keeps the given cursor, default limit 100', async () => {
    const c = new FakeClient().on('LATERAL', { rows: [] })
    const r = await changedSince(c, 'cursor-x')
    expect(r.cursor).toBe('cursor-x')
    expect(c.first('LATERAL')?.params).toEqual(['cursor-x', 100])
  })
})

describe('releaseLocksOfAdmin', () => {
  it('empty types array short-circuits', async () => {
    const c = new FakeClient()
    expect(await releaseLocksOfAdmin(c, 'admin-1', [])).toEqual([])
    expect(c.calls.length).toBe(0)
  })
  it('releases and supersedes sessions (types null)', async () => {
    const c = new FakeClient()
      .on('owner_admin_id = NULL', { rows: [{ resource_type: 'product', resource_id: 'a' }], rowCount: 1 })
      .on('editor_sessions', { rowCount: 1 })
    const out = await releaseLocksOfAdmin(c, 'admin-1')
    expect(out).toEqual([{ resourceType: 'product', resourceId: 'a' }])
    expect(c.first('owner_admin_id = NULL')?.params).toEqual(['admin-1', null])
    expect(c.matching('editor_sessions').length).toBe(1)
  })
  it('passes a non-empty types filter', async () => {
    const c = new FakeClient().on('owner_admin_id = NULL', { rows: [] })
    await releaseLocksOfAdmin(c, 'admin-1', ['product', 'brand'])
    expect(c.first('owner_admin_id = NULL')?.params).toEqual(['admin-1', ['product', 'brand']])
  })
})

describe('dropLocksFor', () => {
  it('deletes lock + presence rows', async () => {
    const c = new FakeClient()
    await dropLocksFor(c, 'product', 'res-1')
    expect(c.matching('DELETE FROM draft_locks').length).toBe(1)
    expect(c.matching('DELETE FROM draft_presence').length).toBe(1)
    expect(c.first('DELETE FROM draft_locks')?.params).toEqual(['product', 'res-1'])
  })
})
