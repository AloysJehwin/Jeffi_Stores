import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/quotations/[id]/resend-email/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'q1' }) })

describe('POST /api/admin/quotations/[id]/resend-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies the resend under quotations:write', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ sent: true }))
    const res = await call()
    expect(await res.json()).toEqual({ sent: true })
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), '/admin/quotations/q1/resend-email', 'quotations:write')
  })

  it('returns the proxy permission failure', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })

  it('propagates an upstream failure', async () => {
    vi.mocked(proxyAdminDocs).mockRejectedValue(new Error('down'))
    await expect(call()).rejects.toThrow('down')
  })
})
