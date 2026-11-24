import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/messaging/proxy', () => ({ proxyAdminMessaging: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/messaging-templates/wa/submit-approval/route'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

const req = () => new NextRequest('http://localhost/api/admin/messaging-templates/wa/submit-approval', { method: 'POST' })

describe('POST messaging-templates/wa/submit-approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards gated on templates:write', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ submitted: true }))
    const r = req()
    expect(await (await POST(r)).json()).toEqual({ submitted: true })
    expect(proxyAdminMessaging).toHaveBeenCalledWith(r, '/wa/submit-approval', 'templates:write')
  })

  it('passes through a rejection and an upstream failure', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req())).status).toBe(403)
    vi.mocked(proxyAdminMessaging).mockResolvedValueOnce(NextResponse.json({ error: 'meta' }, { status: 502 }))
    expect((await POST(req())).status).toBe(502)
  })
})
