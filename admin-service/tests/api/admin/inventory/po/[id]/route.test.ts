import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET, PATCH } from '@admin/app/api/(admin)/admin/inventory/po/[id]/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const ctx = { params: Promise.resolve({ id: 'po1' }) }
const req = (m: string) => new NextRequest('http://localhost/api/admin/inventory/po/po1', { method: m })

describe('inventory/po/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ ok: true }))
  })

  it('GET forwards gated on inventory:read', async () => {
    const r = req('GET')
    expect((await GET(r, ctx)).status).toBe(200)
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1', 'inventory:read')
  })

  it('PATCH forwards gated on inventory:write', async () => {
    const r = req('PATCH')
    await PATCH(r, ctx)
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1', 'inventory:write')
  })

  it('passes through scope rejections and upstream errors', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(403)
    vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'bad' }, { status: 502 }))
    expect((await GET(req('GET'), ctx)).status).toBe(502)
  })
})
