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
  canDiscard: vi.fn(),
  closeLock: vi.fn(),
  draftLockResponse: vi.fn(() => null),
  epochFrom: vi.fn(() => null),
  withDraftWrite: vi.fn(),
}))

import { GET, PATCH, DELETE } from '../../src/admin/po/draft.js'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { canDiscard, closeLock, draftLockResponse, withDraftWrite } from '../../src/lib/draft-locks.js'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockCanDiscard = vi.mocked(canDiscard)
const mockCloseLock = vi.mocked(closeLock)
const mockDraftLockResponse = vi.mocked(draftLockResponse)
const mockWithDraftWrite = vi.mocked(withDraftWrite)

const ID = '33333333-3333-4333-8333-333333333333'
const SUPPLIER = '44444444-4444-4444-8444-444444444444'
const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/po/draft', {
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

describe('GET po/draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await GET(makeReq('GET'), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await GET(makeReq('GET', undefined, noScopeClaims), params)).status).toBe(403)
  })
  it('404 when draft not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect((await GET(makeReq('GET', undefined, adminClaims), params)).status).toBe(404)
  })
  it('200 returns the draft', async () => {
    mockQueryOne.mockResolvedValue({ id: ID, supplier_id: SUPPLIER })
    const res = await GET(makeReq('GET', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).draft.id).toBe(ID)
  })
})

describe('PATCH po/draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await PATCH(makeReq('PATCH', { notes: 'x' }), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await PATCH(makeReq('PATCH', { notes: 'x' }, noScopeClaims), params)).status).toBe(403)
  })
  it('404 when draft is closed/promoted (openDraft false)', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect((await PATCH(makeReq('PATCH', { notes: 'x' }, adminClaims), params)).status).toBe(404)
  })
  it('400 when body fails schema (bad supplier_id)', async () => {
    mockQueryOne.mockResolvedValue({ id: ID }) // openDraft true
    const res = await PATCH(makeReq('PATCH', { supplier_id: 'not-a-uuid' }, adminClaims), params)
    expect(res.status).toBe(400)
  })
  it('200 ok when no updatable fields', async () => {
    mockQueryOne.mockResolvedValue({ id: ID })
    const res = await PATCH(makeReq('PATCH', {}, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockWithDraftWrite).not.toHaveBeenCalled()
  })
  it('200 on successful update with line_items', async () => {
    mockQueryOne.mockResolvedValue({ id: ID })
    mockWithDraftWrite.mockResolvedValue(undefined as any)
    const res = await PATCH(makeReq('PATCH', { notes: 'hi', line_items: [{ sku: 'A' }] }, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockWithDraftWrite).toHaveBeenCalled()
  })
  it('423 when the draft is locked by another', async () => {
    mockQueryOne.mockResolvedValue({ id: ID })
    mockWithDraftWrite.mockRejectedValue(new Error('locked'))
    mockDraftLockResponse.mockReturnValue(NextResponse.json({ error: 'DRAFT_LOCKED' }, { status: 423 }))
    const res = await PATCH(makeReq('PATCH', { notes: 'x' }, adminClaims), params)
    expect(res.status).toBe(423)
  })
})

describe('DELETE po/draft', () => {
  it('401 when unauthenticated', async () => {
    expect((await DELETE(makeReq('DELETE'), params)).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await DELETE(makeReq('DELETE', undefined, noScopeClaims), params)).status).toBe(403)
  })
  it('200 discards draft and closes lock', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    mockCanDiscard.mockResolvedValue(null)
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockCloseLock).toHaveBeenCalledWith(client, expect.anything(), 'po_new', ID, 'discarded')
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
