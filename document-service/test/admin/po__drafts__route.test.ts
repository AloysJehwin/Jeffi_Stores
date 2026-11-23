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
  acquireLock: vi.fn(),
  isDraftLockError: vi.fn(),
  lockNewDraft: vi.fn(),
}))

import { GET, POST } from '../../src/admin/po/drafts.js'
import { queryMany, queryOne } from '@jeffi/tenancy'
import { acquireLock, isDraftLockError, lockNewDraft } from '../../src/lib/draft-locks.js'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockAcquireLock = vi.mocked(acquireLock)
const mockIsDraftLockError = vi.mocked(isDraftLockError)
const mockLockNewDraft = vi.mocked(lockNewDraft)

const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(method: string, body?: any, claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/po/drafts', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })
  if (claims) req.claims = claims
  return req
}

beforeEach(() => vi.clearAllMocks())

describe('GET po/drafts', () => {
  it('401 when unauthenticated', async () => {
    expect((await GET(makeReq('GET'))).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await GET(makeReq('GET', undefined, noScopeClaims))).status).toBe(403)
  })
  it('200 lists my open drafts', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'd1' }] as any)
    const res = await GET(makeReq('GET', undefined, adminClaims))
    expect(res.status).toBe(200)
    expect((await res.json()).drafts).toEqual([{ id: 'd1' }])
  })
})

describe('POST po/drafts', () => {
  it('401 when unauthenticated', async () => {
    expect((await POST(makeReq('POST', {}))).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await POST(makeReq('POST', {}, noScopeClaims))).status).toBe(403)
  })
  it('reuses existing open draft (resumed=true)', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-1' } as any)
    mockAcquireLock.mockResolvedValue(null as any)
    const res = await POST(makeReq('POST', {}, adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'existing-1', resumed: true })
  })
  it('423 when existing draft is locked by another', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-1' } as any)
    const lockErr = { body: () => ({ error: 'DRAFT_LOCKED' }) }
    mockAcquireLock.mockRejectedValue(lockErr)
    mockIsDraftLockError.mockReturnValue(true)
    const res = await POST(makeReq('POST', {}, adminClaims))
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.id).toBe('existing-1')
    expect(body.resumed).toBe(true)
  })
  it('rethrows a non-lock acquire error', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-1' } as any)
    mockAcquireLock.mockRejectedValue(new Error('boom'))
    mockIsDraftLockError.mockReturnValue(false)
    await expect(POST(makeReq('POST', {}, adminClaims))).rejects.toThrow('boom')
  })
  it('400 when body fails schema (bad supplier_id)', async () => {
    mockQueryOne.mockResolvedValue(null) // no existing
    const res = await POST(makeReq('POST', { supplier_id: 'not-a-uuid' }, adminClaims))
    expect(res.status).toBe(400)
  })
  it('creates a new draft and locks it (resumed=false)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing
      .mockResolvedValueOnce({ id: 'new-1' } as any) // insert
    const res = await POST(makeReq('POST', { notes: 'hi' }, adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'new-1', resumed: false })
    expect(mockLockNewDraft).toHaveBeenCalledWith(expect.anything(), 'po_new', 'new-1')
  })
})
