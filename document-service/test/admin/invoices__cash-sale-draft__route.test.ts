import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from '../../src/next.js'

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
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => null),
  withDraftWrite: vi.fn(),
}))

import { GET, PATCH, DELETE } from '../../src/admin/invoices/cash-sale-draft.js'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { canDiscard, closeLock, draftLockResponse, withDraftWrite } from '../../src/lib/draft-locks.js'
import { NextResponse } from '../../src/next.js'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockCanDiscard = vi.mocked(canDiscard)
const mockCloseLock = vi.mocked(closeLock)
const mockDraftLockResponse = vi.mocked(draftLockResponse)
const mockWithDraftWrite = vi.mocked(withDraftWrite)

const ID = '22222222-2222-4222-8222-222222222222'
const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/invoices/cash-sale-draft', {
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

describe('GET cash-sale-draft', () => {
  it('401 when unauthenticated', async () => {
    const res = await GET(makeReq('GET'), params)
    expect(res.status).toBe(401)
  })
  it('403 when scope missing', async () => {
    const res = await GET(makeReq('GET', undefined, noScopeClaims), params)
    expect(res.status).toBe(403)
  })
  it('404 when draft not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('GET', undefined, adminClaims), params)
    expect(res.status).toBe(404)
  })
  it('200 returns the draft', async () => {
    mockQueryOne.mockResolvedValue({ id: ID, label: 'bill' })
    const res = await GET(makeReq('GET', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toEqual({ id: ID, label: 'bill' })
  })
})

describe('PATCH cash-sale-draft', () => {
  it('401 when unauthenticated', async () => {
    const res = await PATCH(makeReq('PATCH', { label: 'x' }), params)
    expect(res.status).toBe(401)
  })
  it('403 when scope missing', async () => {
    const res = await PATCH(makeReq('PATCH', { label: 'x' }, noScopeClaims), params)
    expect(res.status).toBe(403)
  })
  it('400 when body fails schema (bad payment_mode)', async () => {
    const res = await PATCH(makeReq('PATCH', { payment_mode: 'card' }, adminClaims), params)
    expect(res.status).toBe(400)
  })
  it('200 ok with no updatable fields', async () => {
    const res = await PATCH(makeReq('PATCH', {}, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockWithDraftWrite).not.toHaveBeenCalled()
  })
  it('200 on successful update', async () => {
    mockWithDraftWrite.mockResolvedValue({ rowCount: 1 } as any)
    const res = await PATCH(makeReq('PATCH', { label: 'Table 4', items: [{ sku: 'A' }] }, adminClaims), params)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockWithDraftWrite).toHaveBeenCalled()
  })
  it('404 when update matches no rows', async () => {
    mockWithDraftWrite.mockResolvedValue({ rowCount: 0 } as any)
    const res = await PATCH(makeReq('PATCH', { label: 'x' }, adminClaims), params)
    expect(res.status).toBe(404)
  })
  it('423 when draft lock refuses the write', async () => {
    const err = new Error('locked')
    mockWithDraftWrite.mockRejectedValue(err)
    mockDraftLockResponse.mockReturnValue(NextResponse.json({ error: 'DRAFT_LOCKED' }, { status: 423 }))
    const res = await PATCH(makeReq('PATCH', { label: 'x' }, adminClaims), params)
    expect(res.status).toBe(423)
  })
  it('rethrows a non-lock error', async () => {
    mockWithDraftWrite.mockRejectedValue(new Error('boom'))
    mockDraftLockResponse.mockReturnValue(null)
    await expect(PATCH(makeReq('PATCH', { label: 'x' }, adminClaims), params)).rejects.toThrow('boom')
  })
})

describe('DELETE cash-sale-draft', () => {
  it('401 when unauthenticated', async () => {
    const res = await DELETE(makeReq('DELETE'), params)
    expect(res.status).toBe(401)
  })
  it('403 when scope missing', async () => {
    const res = await DELETE(makeReq('DELETE', undefined, noScopeClaims), params)
    expect(res.status).toBe(403)
  })
  it('200 discards the draft and closes the lock', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    mockCanDiscard.mockResolvedValue(null)
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockCloseLock).toHaveBeenCalledWith(client, expect.anything(), 'cash_sale', ID, 'discarded')
  })
  it('200 but skips closeLock when nothing deleted', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    mockCanDiscard.mockResolvedValue(null)
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(200)
    expect(mockCloseLock).not.toHaveBeenCalled()
  })
  it('423 when canDiscard denies (lock held)', async () => {
    const denied = new Error('locked')
    mockWithTx.mockImplementation(async (fn: any) => {
      mockCanDiscard.mockResolvedValue(denied as any)
      const client = { query: vi.fn() }
      return fn(client)
    })
    mockDraftLockResponse.mockReturnValue(NextResponse.json({ error: 'DRAFT_LOCKED' }, { status: 423 }))
    const res = await DELETE(makeReq('DELETE', undefined, adminClaims), params)
    expect(res.status).toBe(423)
  })
})
