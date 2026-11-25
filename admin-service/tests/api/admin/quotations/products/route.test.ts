import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/quotations/products/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const call = () => GET(new NextRequest('http://localhost/x?q=shoe'))

describe('GET /api/admin/quotations/products', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies the product search under quotations:read', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ products: [] }))
    const res = await call()
    expect(await res.json()).toEqual({ products: [] })
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), '/admin/quotations/products', 'quotations:read')
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
