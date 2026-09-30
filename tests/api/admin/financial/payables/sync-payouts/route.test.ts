import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

// Set env vars before ANY module import so module-level constants capture them
process.env.RAZORPAYX_KEY_ID = 'rzp_key'
process.env.RAZORPAYX_KEY_SECRET = 'rzp_secret'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, query } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['financial'] }

let POST: (req: NextRequest) => Promise<Response>

beforeAll(async () => {
  // Import after env vars are set so module-level RZP_KEY/SECRET constants are captured
  const mod = await import('@/app/api/(admin)/admin/financial/payables/sync-payouts/route')
  POST = mod.POST
})

function makeReq() {
  return new NextRequest('http://localhost/api/admin/financial/payables/sync-payouts', {
    method: 'POST',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

describe('POST /api/admin/financial/payables/sync-payouts', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns synced:0 when no pending payouts', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  it('syncs pending payouts and updates status', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const pending = [
      { id: 'ep-1', payout_id: 'pout_1', expense_id: 'exp-1' },
      { id: 'ep-2', payout_id: 'pout_2', expense_id: 'exp-2' },
    ]
    mockQueryMany
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce([{ amount: '500' }])
      .mockResolvedValueOnce([{ total_amount: '1000' }])
      .mockResolvedValueOnce([{ amount: '200' }])
      .mockResolvedValueOnce([{ total_amount: '200' }])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'processed' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'processed' }) } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(2)
  })

  it('skips payout when RZP fetch fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValueOnce([{ id: 'ep-1', payout_id: 'pout_bad', expense_id: 'exp-1' }])
    mockFetch.mockResolvedValue({ ok: false } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  it('handles non-terminal status without updating expense', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValueOnce([{ id: 'ep-1', payout_id: 'pout_1', expense_id: 'exp-1' }])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'processing' }),
    } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(1)
    // query called once for status update only, not for expense status
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('marks expense as paid when fully covered', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'ep-1', payout_id: 'pout_1', expense_id: 'exp-1' }])
      .mockResolvedValueOnce([{ amount: '1000' }])
      .mockResolvedValueOnce([{ total_amount: '1000' }])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'processed' }),
    } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE expenses'), expect.arrayContaining(['paid']))
  })

  it('marks expense as partial when partially paid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'ep-1', payout_id: 'pout_1', expense_id: 'exp-1' }])
      .mockResolvedValueOnce([{ amount: '400' }])
      .mockResolvedValueOnce([{ total_amount: '1000' }])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'processed' }),
    } as any)
    const res = await POST(makeReq())
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE expenses'),
      expect.arrayContaining(['partial'])
    )
  })
})
