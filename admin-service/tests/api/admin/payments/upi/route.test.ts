import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiAdminList: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/payments/upi/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { handleUpiAdminList } from '@/lib/payments/upi/handlers'

const req = () => new NextRequest('http://localhost/api/admin/payments/upi?status=awaiting_confirmation')

describe('GET /api/admin/payments/upi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the auth failure response (401/403) without listing', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(handleUpiAdminList).not.toHaveBeenCalled()
  })

  it('delegates the list to the handler', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(handleUpiAdminList).mockResolvedValue(NextResponse.json({ intents: [] }))
    const res = await GET(req())
    expect(await res.json()).toEqual({ intents: [] })
    expect(handleUpiAdminList).toHaveBeenCalledTimes(1)
  })

  it('propagates a handler failure', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as never)
    vi.mocked(handleUpiAdminList).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
