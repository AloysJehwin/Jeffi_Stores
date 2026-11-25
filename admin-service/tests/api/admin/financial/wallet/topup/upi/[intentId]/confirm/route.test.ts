import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiConfirm: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/financial/wallet/topup/upi/[intentId]/confirm/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { handleUpiConfirm } from '@/lib/payments/upi/handlers'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['delhivery'] }
const AUTH = { kind: 'admin', adminId: 'a1' }
const req = () => new NextRequest('http://localhost/api/admin/financial/wallet/topup/upi/intent-1/confirm', { method: 'POST' })
const ctx = { params: Promise.resolve({ intentId: 'intent-1' }) }
const call = () => POST(req(), ctx)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(handleUpiConfirm).mockResolvedValue(NextResponse.json({ ok: true, status: 'pending' }))
})

describe('POST /api/admin/financial/wallet/topup/upi/[intentId]/confirm', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await call()).status).toBe(401)
    expect(handleUpiConfirm).not.toHaveBeenCalled()
  })

  it('returns 403 without delhivery:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['delhivery'], 'delhivery:write')
    expect(handleUpiConfirm).not.toHaveBeenCalled()
  })

  it('hands the request to the UPI handler as the admin', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'pending' })
    expect(handleUpiConfirm).toHaveBeenCalledWith(expect.any(NextRequest), 'intent-1', AUTH)
  })

  it('passes the handler\u2019s failure response through', async () => {
    vi.mocked(handleUpiConfirm).mockResolvedValue(NextResponse.json({ error: 'Intent not found' }, { status: 404 }))
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Intent not found' })
  })
})
