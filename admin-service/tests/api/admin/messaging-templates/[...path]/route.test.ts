import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/messaging/proxy', () => ({ proxyAdminMessaging: vi.fn() }))

import { GET, POST, PUT, DELETE } from '@admin/app/api/(admin)/admin/messaging-templates/[...path]/route'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })
const req = (m: string) => new NextRequest('http://localhost/api/admin/messaging-templates/a/b', { method: m })

describe('messaging-templates/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ ok: true }))
  })

  it('GET is gated on templates:read and encodes each segment', async () => {
    const r = req('GET')
    await GET(r, ctx(['order shipped', 'v/1']))
    expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/v2/templates/order%20shipped/v%2F1', 'templates:read')
  })

  for (const [name, fn] of [['POST', POST], ['PUT', PUT], ['DELETE', DELETE]] as const) {
    it(`${name} is gated on templates:write`, async () => {
      const r = req(name)
      await fn(r, ctx(['fam']))
      expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/v2/templates/fam', 'templates:write')
    })
  }

  it('passes through a rejection', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await DELETE(req('DELETE'), ctx(['fam']))).status).toBe(403)
  })
})
