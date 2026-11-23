import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('../../src/lib/scopes.js', () => ({
  hasScope: vi.fn().mockReturnValue(true),
}))

const { FakeDraftLockError } = vi.hoisted(() => {
  class FakeDraftLockError extends Error {
    code: string
    lock: any
    constructor(code: string, lock: any) {
      super(code)
      this.code = code
      this.lock = lock
    }
    body() {
      return { error: 'DRAFT_LOCKED', code: this.code }
    }
  }
  return { FakeDraftLockError }
})

vi.mock('@jeffi/draft-locks', () => ({
  DRAFT_RESOURCES: { invoice: { label: 'Invoice' }, quotation: { label: 'Quotation' } },
  DraftLockError: FakeDraftLockError,
  isDraftLockError: (e: unknown) => e instanceof FakeDraftLockError,
  isLockOverrideRole: vi.fn(),
  getLock: vi.fn(),
  lockMap: vi.fn(),
  acquire: vi.fn(),
  close: vi.fn(),
  assertHolder: vi.fn(),
  parseEpoch: vi.fn(),
  DRAFT_LOCK_EPOCH_HEADER: 'x-draft-lock-epoch',
}))

import { acquireLock, closeAfter, canDiscard, lockedByOther, lockBadges } from '../../src/lib/draft-locks.js'
import { query, withTransaction } from '@jeffi/tenancy'
import * as dl from '@jeffi/draft-locks'

const ACTOR = { adminId: 'adm-1', role: 'manager', scopes: [] as string[] }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: vi.fn() }))
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

describe('acquireLock', () => {
  it('returns null when no actor', async () => {
    expect(await acquireLock(null, null, 'invoice', 'id1')).toBeNull()
    expect(dl.acquire).not.toHaveBeenCalled()
  })

  it('acquires on the provided client directly', async () => {
    const client = { query: vi.fn() } as any
    vi.mocked(dl.acquire).mockResolvedValue({ change: 'acquired', lock: { via: 'ui', epoch: 2 } } as any)
    const res = await acquireLock(client, ACTOR, 'invoice', 'id1')
    expect(dl.acquire).toHaveBeenCalledWith(client, ACTOR, 'invoice', 'id1', expect.anything())
    expect(res?.change).toBe('acquired')
  })

  it('acquires in a transaction and audits when no client', async () => {
    vi.mocked(dl.acquire).mockResolvedValue({ change: 'acquired', lock: { via: 'api', epoch: 1 } } as any)
    await acquireLock(null, ACTOR, 'quotation', 'id2')
    expect(withTransaction).toHaveBeenCalled()
    // logChange on 'acquired' writes an audit row
    const auditCall = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('admin_audit_log'))
    expect(auditCall).toBeTruthy()
  })
})

describe('closeAfter', () => {
  it('no-op without an actor', async () => {
    await closeAfter(null, 'invoice', 'id1', 'published' as any)
    expect(dl.close).not.toHaveBeenCalled()
  })

  it('closes the lock in a transaction', async () => {
    vi.mocked(dl.close).mockResolvedValue(undefined as any)
    await closeAfter(ACTOR, 'invoice', 'id1', 'published' as any)
    expect(dl.close).toHaveBeenCalled()
  })

  it('swallows a close error (never fails caller)', async () => {
    vi.mocked(dl.close).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(closeAfter(ACTOR, 'invoice', 'id1', 'published' as any)).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

describe('canDiscard', () => {
  it('returns null without an actor', async () => {
    expect(await canDiscard(null, 'invoice', 'id1')).toBeNull()
  })

  it('returns null when no lock / lock closed / not owner-editable', async () => {
    vi.mocked(dl.getLock).mockResolvedValue(null as any)
    expect(await canDiscard(ACTOR, 'invoice', 'id1')).toBeNull()
  })

  it('returns null when the actor already holds the lock', async () => {
    vi.mocked(dl.getLock).mockResolvedValue({ ownerId: 'adm-1', ownerCanEdit: true, closedAt: null } as any)
    expect(await canDiscard(ACTOR, 'invoice', 'id1')).toBeNull()
  })

  it('returns a DraftLockError when held by another and actor cannot override', async () => {
    vi.mocked(dl.getLock).mockResolvedValue({ ownerId: 'other', ownerCanEdit: true, closedAt: null, ownerName: 'Bob' } as any)
    vi.mocked(dl.isLockOverrideRole).mockReturnValue(false)
    const r = await canDiscard(ACTOR, 'invoice', 'id1')
    expect(r).toBeInstanceOf(FakeDraftLockError)
  })

  it('override role audits + notifies and returns null', async () => {
    vi.mocked(dl.getLock).mockResolvedValue({ ownerId: 'other', ownerCanEdit: true, closedAt: null, ownerName: 'Bob' } as any)
    vi.mocked(dl.isLockOverrideRole).mockReturnValue(true)
    const r = await canDiscard(ACTOR, 'quotation', 'id1')
    expect(r).toBeNull()
    const sqls = vi.mocked(query).mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('admin_audit_log'))).toBe(true)
    expect(sqls.some(s => s.includes('admin_notifications'))).toBe(true)
  })

  it('override role still returns null even if the notification insert throws', async () => {
    vi.mocked(dl.getLock).mockResolvedValue({ ownerId: 'other', ownerCanEdit: true, closedAt: null, ownerName: null } as any)
    vi.mocked(dl.isLockOverrideRole).mockReturnValue(true)
    vi.mocked(query).mockRejectedValue(new Error('insert fail'))
    expect(await canDiscard(ACTOR, 'invoice', 'id1')).toBeNull()
  })
})

describe('lockedByOther', () => {
  it('returns 423 when locked by another editing admin', async () => {
    vi.mocked(dl.getLock).mockResolvedValue({ ownerId: 'other', ownerCanEdit: true, closedAt: null } as any)
    const res = await lockedByOther(ACTOR, 'invoice', 'id1')
    expect(res?.status).toBe(423)
  })
  it('returns null when the lock store is unavailable', async () => {
    vi.mocked(dl.getLock).mockRejectedValue(new Error('down'))
    expect(await lockedByOther(ACTOR, 'invoice', 'id1')).toBeNull()
  })
})

describe('lockBadges', () => {
  it('short-circuits on empty ids', async () => {
    expect(await lockBadges(ACTOR, 'invoice', [])).toEqual({})
    expect(dl.lockMap).not.toHaveBeenCalled()
  })
  it('maps mine vs others', async () => {
    vi.mocked(dl.lockMap).mockResolvedValue({
      a: { ownerId: 'adm-1', ownerName: 'Me', lastActiveAt: 't' },
      b: { ownerId: 'other', ownerName: 'Bob', lastActiveAt: 't' },
    } as any)
    const out = await lockBadges(ACTOR, 'invoice', ['a', 'b'])
    expect(out.a.mine).toBe(true)
    expect(out.b.mine).toBe(false)
  })
})
