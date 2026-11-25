import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/messaging/proxy', () => ({ proxyAdminMessaging: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/messaging-templates/route'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

const req = (m: string) => new NextRequest('http://localhost/api/admin/messaging-templates', { method: m })

describe('messaging-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ items: [] }))
  })

  it('GET lists through the v2 library gated on templates:read', async () => {
    const r = req('GET')
    expect(await (await GET(r)).json()).toEqual({ items: [] })
    expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/v2/templates', 'templates:read')
  })

  it('POST upserts gated on templates:write', async () => {
    const r = req('POST')
    await POST(r)
    expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/v2/templates', 'templates:write')
  })

  it('passes through a scope rejection and an upstream failure', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req('POST'))).status).toBe(403)
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'bad' }, { status: 502 }))
    expect((await GET(req('GET'))).status).toBe(502)
  })
})
