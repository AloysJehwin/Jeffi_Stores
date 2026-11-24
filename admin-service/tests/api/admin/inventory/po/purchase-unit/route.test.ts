import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/inventory/po/purchase-unit/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const req = () => new NextRequest('http://localhost/api/admin/inventory/po/purchase-unit?sku=1')

describe('GET inventory/po/purchase-unit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on inventory:read', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ unit: 'box' }))
    const r = req()
    expect(await (await GET(r)).json()).toEqual({ unit: 'box' })
    expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/purchase-unit', 'inventory:read')
  })

  it('passes through a rejection', async () => {
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
  })
})
