import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/inventory/po/[id]/resend-email/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const ctx = { params: Promise.resolve({ id: 'po1' }) }
const req = () => new NextRequest('http://localhost/api/admin/inventory/po/po1/resend-email', { method: 'POST' })

describe('POST inventory/po/[id]/resend-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on inventory:write', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ sent: true }))
    const r = req()
    expect(await (await POST(r, ctx)).json()).toEqual({ sent: true })
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1/resend-email', 'inventory:write')
  })

  it('passes through a rejection and an upstream failure', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'mail down' }, { status: 502 }))
    expect((await POST(req(), ctx)).status).toBe(502)
  })
})
