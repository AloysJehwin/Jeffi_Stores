import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/quotations/[id]/pdf/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const call = () => GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: 'q1' }) })

describe('GET /api/admin/quotations/[id]/pdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies to the quotation PDF under quotations:read', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(new Response('pdf', { status: 200 }) as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), '/admin/quotations/q1/pdf', 'quotations:read')
  })

  it('returns the proxy auth failure', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await call()).status).toBe(401)
  })

  it('propagates an upstream failure', async () => {
    vi.mocked(proxyAdminDocs).mockRejectedValue(new Error('down'))
    await expect(call()).rejects.toThrow('down')
  })
})
