import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/messaging/proxy', () => ({ proxyAdminMessaging: vi.fn() }))
vi.mock('@/lib/shared/send-by-template', () => ({ brandFields: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/messaging-templates/preview/route'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'
import { brandFields } from '@/lib/shared/send-by-template'

const req = (body: string) =>
  new NextRequest('http://localhost/api/admin/messaging-templates/preview', { method: 'POST', body, headers: { 'x-session-marker': 'abc', 'content-type': 'text/plain' } })

describe('POST messaging-templates/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(brandFields).mockResolvedValue({ brand: 'Acme', footer: 'F' } as any)
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ html: '<p/>' }))
  })

  it('merges the brand fields into the body and keeps the session cookie', async () => {
    const res = await POST(req(JSON.stringify({ slug: 's', variables: { a: 1 } })))
    expect(await res.json()).toEqual({ html: '<p/>' })
    expect(brandFields).toHaveBeenCalledWith('email')
    const [forwarded, path, scope] = vi.mocked(proxyAdminMessaging).mock.calls[0]
    expect(path).toBe('/v2/templates/preview')
    expect(scope).toBe('templates:read')
    expect(await forwarded.json()).toEqual({ slug: 's', variables: { a: 1 }, brand: 'Acme', footer: 'F' })
    expect(forwarded.headers.get('content-type')).toBe('application/json')
    expect(forwarded.headers.get('x-session-marker')).toBe('abc')
  })

  it('still forwards the brand fields when the body is not JSON', async () => {
    await POST(req('not json'))
    const forwarded = vi.mocked(proxyAdminMessaging).mock.calls[0][0]
    expect(await forwarded.json()).toEqual({ brand: 'Acme', footer: 'F' })
  })

  it('passes through a rejection', async () => {
    vi.mocked(proxyAdminMessaging).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req('{}'))).status).toBe(403)
  })

  it('propagates a brand lookup failure', async () => {
    vi.mocked(brandFields).mockRejectedValue(new Error('db'))
    await expect(POST(req('{}'))).rejects.toThrow('db')
    expect(proxyAdminMessaging).not.toHaveBeenCalled()
  })
})
