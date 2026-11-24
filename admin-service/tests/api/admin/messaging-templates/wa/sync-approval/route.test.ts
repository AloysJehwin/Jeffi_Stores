import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/messaging/proxy', () => ({ proxyAdminMessaging: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/messaging-templates/wa/sync-approval/route'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

const req = () => new NextRequest('http://localhost/api/admin/messaging-templates/wa/sync-approval', { method: 'POST' })

describe('POST messaging-templates/wa/sync-approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on templates:write', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ synced: 3 }))
    const r = req()
    expect(await (await POST(r)).json()).toEqual({ synced: 3 })
    expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/wa/sync-approval', 'templates:write')
  })

  it('passes through a rejection and an upstream failure', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await POST(req())).status).toBe(401)
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'meta' }, { status: 502 }))
    expect((await POST(req())).status).toBe(502)
  })
})
