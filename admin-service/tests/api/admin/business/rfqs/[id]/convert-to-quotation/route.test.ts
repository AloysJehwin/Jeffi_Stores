import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/business/rfqs/[id]/convert-to-quotation/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const req = () => new NextRequest('http://localhost/api/admin/business/rfqs/r1/convert-to-quotation', { method: 'POST' })

describe('POST business/rfqs/[id]/convert-to-quotation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards to document-service gated on business_rfqs:write', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ ok: true }, { status: 201 }))
    const r = req()
    const res = await POST(r, { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(201)
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/business/rfqs/r1/convert-to-quotation', 'business_rfqs:write')
  })

  it('passes through a scope rejection', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await POST(req(), { params: Promise.resolve({ id: 'r1' }) })).status).toBe(403)
  })

  it('passes through an upstream failure', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'bad' }, { status: 400 }))
    expect((await POST(req(), { params: Promise.resolve({ id: 'r1' }) })).status).toBe(400)
  })
})
