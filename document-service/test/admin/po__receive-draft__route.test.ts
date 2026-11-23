import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from '../../src/next.js'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('../../src/lib/draft-locks.js', () => ({
  acquireLock: vi.fn(),
  announceLock: vi.fn(),
  assertHolder: vi.fn(),
  canDiscard: vi.fn(),
  closeLock: vi.fn(),
  draftLockResponse: vi.fn(() => null),
  epochFrom: vi.fn(() => null),
}))

import { GET, PATCH, DELETE } from '../../src/admin/po/receive-draft.js'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import {
  acquireLock,
  announceLock,
  assertHolder,
  canDiscard,
  closeLock,
  draftLockResponse,
} from '../../src/lib/draft-locks.js'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockAcquireLock = vi.mocked(acquireLock)
const mockAnnounceLock = vi.mocked(announceLock)
const mockAssertHolder = vi.mocked(assertHolder)
const mockCanDiscard = vi.mocked(canDiscard)
const mockCloseLock = vi.mocked(closeLock)
const mockDraftLockResponse = vi.mocked(draftLockResponse)

const ID = '77777777-7777-4777-8777-777777777777'
const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/po/receive-draft', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
  if (claims) req.claims = claims
  return req
}
const params = { params: Promise.resolve({ id: ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockDraftLockResponse.mockReturnValue(null)
})

describe('GET po/receive-draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await GET(makeReq('GET'), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await GET(makeReq('GET', undefined, noScopeClaims), params)).status).toBe(403)
  })
  it('200 returns null draft when none exists', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('GET', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toBeNull()
  })
  it('200 returns the draft', async () => {
    mockQueryOne.mockResolvedValue({ po_id: ID, line_items: [] })
    const res = await GET(makeReq('GET', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).draft.po_id).toBe(ID)
  })
})

describe('PATCH po/receive-draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await PATCH(makeReq('PATCH', {}), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await PATCH(makeReq('PATCH', {}, noScopeClaims), params)).status).toBe(403)
  })
  it('400 when body fails schema (line_items not array)', async () => {
    const res = await PATCH(makeReq('PATCH', { line_items: 'nope' }, adminClaims), params)
    expect(res.status).toBe(400)
  })
  it('404 when PO not found', async () => {
    mockQueryOne.mockResolvedValue(null) // PO lookup
    const res = await PATCH(makeReq('PATCH', { line_items: [] }, adminClaims), params)
    expect(res.status).toBe(404)
  })
  it('200 upsert inserts a new draft and acquires lock', async () => {
    mockQueryOne.mockResolvedValue({ id: ID }) // PO exists
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ inserted: true }] }) }
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    mockAcquireLock.mockResolvedValue({ change: 'acquired' } as any)
    const res = await PATCH(makeReq('PATCH', { line_items: [{ x: 1 }] }, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockAcquireLock).toHaveBeenCalled()
    expect(mockAssertHolder).not.toHaveBeenCalled()
    expect(mockAnnounceLock).toHaveBeenCalled()
  })
  it('200 upsert updates existing draft and asserts holder', async () => {
    mockQueryOne.mockResolvedValue({ id: ID })
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ inserted: false }] }) }
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    mockAssertHolder.mockResolvedValue({ change: 'held' } as any)
    const res = await PATCH(makeReq('PATCH', { serials: [{ s: 1 }] }, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockAssertHolder).toHaveBeenCalled()
    expect(mockAcquireLock).not.toHaveBeenCalled()
  })
  it('423 when the lock refuses the write', async () => {
    mockQueryOne.mockResolvedValue({ id: ID })
    mockWithTx.mockRejectedValue(new Error('locked'))
    mockDraftLockResponse.mockReturnValue(NextResponse.json({ error: 'DRAFT_LOCKED' }, { status: 423 }))
    const res = await PATCH(makeReq('PATCH', { line_items: [] }, adminClaims), params)
    expect(res.status).toBe(423)
  })
})

describe('DELETE po/receive-draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await DELETE(makeReq('DELETE'), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await DELETE(makeReq('DELETE', undefined, noScopeClaims), params)).status).toBe(403)
  })
  it('200 deletes draft and closes lock', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    mockCanDiscard.mockResolvedValue(null)
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockCloseLock).toHaveBeenCalledWith(client, expect.anything(), 'po_receive', ID, 'discarded')
  })
  it('200 skips closeLock when nothing deleted', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    mockCanDiscard.mockResolvedValue(null)
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockCloseLock).not.toHaveBeenCalled()
  })
  it('423 when canDiscard denies', async () => {
    mockWithTx.mockImplementation(async (fn: any) => {
      mockCanDiscard.mockResolvedValue(new Error('locked') as any)
      return fn({ query: vi.fn() })
    })
    mockDraftLockResponse.mockReturnValue(NextResponse.json({ error: 'DRAFT_LOCKED' }, { status: 423 }))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(423)
  })
})
