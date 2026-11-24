import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/inventory/po/[id]/receive/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const ctx = { params: Promise.resolve({ id: 'po1' }) }
const req = () => new NextRequest('http://localhost/api/admin/inventory/po/po1/receive', { method: 'POST' })

describe('POST inventory/po/[id]/receive', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on inventory:write', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ received: true }))
    const r = req()
    expect(await (await POST(r, ctx)).json()).toEqual({ received: true })
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1/receive', 'inventory:write')
  })

  it('passes through a rejection and an upstream failure', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req(), ctx)).status).toBe(403)
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'bad' }, { status: 409 }))
    expect((await POST(req(), ctx)).status).toBe(409)
  })
})
