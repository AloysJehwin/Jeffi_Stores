import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/inventory/po/draft/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const req = (m: string) => new NextRequest('http://localhost/api/admin/inventory/po/draft', { method: m })

describe('inventory/po/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ ok: true }))
  })

  it('GET and POST forward gated on inventory:write', async () => {
    const g = req('GET')
    await GET(g)
    expect(proxyAdminDocs).toHaveBeenLastCalledWith(g, '/admin/inventory/po/draft', 'inventory:write')
    const p = req('POST')
    await POST(p)
    expect(proxyAdminDocs).toHaveBeenLastCalledWith(p, '/admin/inventory/po/draft', 'inventory:write')
  })

  it('passes through rejections and upstream failures', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(req('GET'))).status).toBe(401)
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'bad' }, { status: 400 }))
    expect((await POST(req('POST'))).status).toBe(400)
  })
})
