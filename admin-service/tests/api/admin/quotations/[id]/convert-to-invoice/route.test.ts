import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/quotations/[id]/convert-to-invoice/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'q1' }) })

describe('POST /api/admin/quotations/[id]/convert-to-invoice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies to document-service under quotations:write and passes failures through', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(proxyAdminDocs).toHaveBeenCalledWith(expect.anything(), '/admin/quotations/q1/convert-to-invoice', 'quotations:write')
  })

  it('returns the service response untouched (UPI QR conversions go through qr-intents)', async () => {
    const out = NextResponse.json({ invoiceId: 'i1' }, { status: 201 })
    vi.mocked(proxyAdminDocs).mockResolvedValue(out)
    expect(await call()).toBe(out)
  })
})
