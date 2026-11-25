import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiAdminDecide: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/payments/upi/[intentId]/decide/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { handleUpiAdminDecide } from '@/lib/payments/upi/handlers'

const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), {
    params: Promise.resolve({ intentId: 'i1' }),
  })

describe('POST /api/admin/payments/upi/[intentId]/decide', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the auth failure without deciding (needs financial:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call()).status).toBe(401)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:write')
    expect(handleUpiAdminDecide).not.toHaveBeenCalled()
  })

  it('passes the intent id and admin to the handler', async () => {
    const admin = { adminId: 'a1' }
    vi.mocked(requireAdminScope).mockResolvedValue(admin as never)
    vi.mocked(handleUpiAdminDecide).mockResolvedValue(NextResponse.json({ ok: true }))
    const res = await call()
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpiAdminDecide).toHaveBeenCalledWith(expect.anything(), 'i1', admin)
  })

  it('relays a handler rejection response', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(handleUpiAdminDecide).mockResolvedValue(NextResponse.json({ error: 'UTR mismatch' }, { status: 409 }))
    expect((await call()).status).toBe(409)
  })
})
