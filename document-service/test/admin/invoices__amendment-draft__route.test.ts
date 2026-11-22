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
  lockNewDraft: vi.fn(),
  isDraftLockError: vi.fn(),
}))

import { POST } from '../../src/admin/invoices/amendment-draft.js'
import { queryOne, withTransaction } from '@jeffi/tenancy'
import { acquireLock, lockNewDraft, isDraftLockError } from '../../src/lib/draft-locks.js'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockAcquireLock = vi.mocked(acquireLock)
const mockLockNewDraft = vi.mocked(lockNewDraft)
const mockIsDraftLockError = vi.mocked(isDraftLockError)

const ID = '11111111-1111-4111-8111-111111111111'

function makeReq(claims?: any) {
  const req = new NextRequest('http://localhost/api/admin/invoices/amendment-draft', { method: 'POST' })
  if (claims) req.claims = claims
  return req
}
const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

const ORIGINAL = { id: ID, user_id: 'u1', invoice_number: 'INV-1', customer_name: 'John' }

beforeEach(() => vi.clearAllMocks())

describe('POST amendment-draft', () => {
  it('401 when unauthenticated', async () => {
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(401)
  })

  it('403 when scope missing', async () => {
    const res = await POST(makeReq(noScopeClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(403)
  })

  it('404 when original not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(404)
  })

  it('400 when invoice not finalized (no invoice_number)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...ORIGINAL, invoice_number: null })
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/finalized/)
  })

  it('409 when amendment draft already exists and lock acquired', async () => {
    mockQueryOne
      .mockResolvedValueOnce(ORIGINAL) // original
      .mockResolvedValueOnce({ id: 'draft-1' }) // existingDraft
    mockAcquireLock.mockResolvedValue({ lock: { via: 'owner' } } as any)
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.draftId).toBe('draft-1')
  })

  it('423 when existing draft held by another (lock error)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(ORIGINAL)
      .mockResolvedValueOnce({ id: 'draft-1' })
    const lockErr = { body: () => ({ error: 'DRAFT_LOCKED' }) }
    mockAcquireLock.mockRejectedValue(lockErr)
    mockIsDraftLockError.mockReturnValue(true)
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.draftId).toBe('draft-1')
    expect(body.error).toBe('DRAFT_LOCKED')
  })

  it('500 when acquireLock throws a non-lock error', async () => {
    mockQueryOne
      .mockResolvedValueOnce(ORIGINAL)
      .mockResolvedValueOnce({ id: 'draft-1' })
    mockAcquireLock.mockRejectedValue(new Error('boom'))
    mockIsDraftLockError.mockReturnValue(false)
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })

  it('creates amendment draft on happy path', async () => {
    mockQueryOne
      .mockResolvedValueOnce(ORIGINAL)
      .mockResolvedValueOnce(null) // no existing draft
    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'new-draft', order_number: 'AMD-1' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draftId).toBe('new-draft')
    expect(body.orderNumber).toBe('AMD-1')
    expect(mockLockNewDraft).toHaveBeenCalledWith(expect.anything(), 'invoice', 'new-draft')
  })

  it('500 when withTransaction fails', async () => {
    mockQueryOne.mockResolvedValueOnce(ORIGINAL).mockResolvedValueOnce(null)
    mockWithTx.mockRejectedValue(new Error('DB write failed'))
    const res = await POST(makeReq(adminClaims), { params: Promise.resolve({ id: ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB write failed')
  })
})
