import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiStatus: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/wallet/topup/upi/[intentId]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { handleUpiStatus } from '@/lib/payments/upi/handlers'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['delhivery'] }
const AUTH = { kind: 'admin', adminId: 'a1' }
const req = () => new NextRequest('http://localhost/api/admin/financial/wallet/topup/upi/intent-1', { method: 'GET' })
const ctx = { params: Promise.resolve({ intentId: 'intent-1' }) }
const call = () => GET(req(), ctx)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(handleUpiStatus).mockResolvedValue(NextResponse.json({ ok: true, status: 'pending' }))
})

describe('GET /api/admin/financial/wallet/topup/upi/[intentId]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await call()).status).toBe(401)
    expect(handleUpiStatus).not.toHaveBeenCalled()
  })

  it('hands the request to the UPI handler as the admin', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'pending' })
    expect(handleUpiStatus).toHaveBeenCalledWith('intent-1', AUTH)
  })

  it('passes the handler\u2019s failure response through', async () => {
    vi.mocked(handleUpiStatus).mockResolvedValue(NextResponse.json({ error: 'Intent not found' }, { status: 404 }))
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Intent not found' })
  })
})
