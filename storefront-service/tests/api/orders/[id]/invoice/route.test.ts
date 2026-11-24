import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const proxyUserOrAdminDocs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/documents/proxy', () => ({ proxyUserOrAdminDocs }))

import { GET, POST } from '@storefront/app/api/(public)/orders/[id]/invoice/route'

const ctx = { params: Promise.resolve({ id: 'o1' }) }
const req = (method: string) => new NextRequest('http://localhost/api/orders/o1/invoice', { method })

describe('/api/orders/[id]/invoice', () => {
  beforeEach(() => {
    proxyUserOrAdminDocs.mockResolvedValue(new NextResponse('PDF', { status: 200 }))
  })

  it('GET proxies to the document service for this order', async () => {
    const r = req('GET')
    const res = await GET(r, ctx)
    expect(res.status).toBe(200)
    expect(proxyUserOrAdminDocs).toHaveBeenCalledWith(r, '/orders/o1/invoice')
  })

  it('POST proxies the same path (generate)', async () => {
    const r = req('POST')
    await POST(r, ctx)
    expect(proxyUserOrAdminDocs).toHaveBeenCalledWith(r, '/orders/o1/invoice')
  })

  it('passes an auth rejection from the proxy through', async () => {
    proxyUserOrAdminDocs.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req('GET'), ctx)).status).toBe(401)
  })
})
