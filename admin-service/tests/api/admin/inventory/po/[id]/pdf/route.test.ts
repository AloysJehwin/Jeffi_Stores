import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/inventory/po/[id]/pdf/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const ctx = { params: Promise.resolve({ id: 'po1' }) }
const req = () => new NextRequest('http://localhost/api/admin/inventory/po/po1/pdf')

describe('GET inventory/po/[id]/pdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on inventory:read and streams the response', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(new NextResponse('%PDF', { headers: { 'content-type': 'application/pdf' } }))
    const r = req()
    const res = await GET(r, ctx)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1/pdf', 'inventory:read')
  })

  it('passes through a rejection', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req(), ctx)).status).toBe(403)
  })
})
