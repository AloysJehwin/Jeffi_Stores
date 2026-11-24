import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/documents/proxy', () => ({ proxyAdminDocs: vi.fn() }))

import { GET, PATCH, DELETE } from '@admin/app/api/(admin)/admin/inventory/po/[id]/receive/draft/route'
import { proxyAdminDocs } from '@/lib/documents/proxy'

const ctx = { params: Promise.resolve({ id: 'po1' }) }
const req = (m: string) => new NextRequest('http://localhost/api/admin/inventory/po/po1/receive/draft', { method: m })

describe('inventory/po/[id]/receive/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(proxyAdminDocs).mockResolvedValue(NextResponse.json({ ok: true }))
  })

  for (const [name, fn] of [['GET', GET], ['PATCH', PATCH], ['DELETE', DELETE]] as const) {
    it(`${name} forwards gated on inventory:write`, async () => {
      const r = req(name)
      expect((await fn(r, ctx)).status).toBe(200)
      expect(proxyAdminDocs).toHaveBeenCalledWith(r, '/admin/inventory/po/po1/receive/draft', 'inventory:write')
    })
    it(`${name} passes through a rejection`, async () => {
      vi.mocked(proxyAdminDocs).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
      expect((await fn(req(name), ctx)).status).toBe(403)
    })
  }
})
