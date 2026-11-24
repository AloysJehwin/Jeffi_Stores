import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ clearPortalCookie: vi.fn((res: Response) => res) }))
vi.mock('@/lib/auth/portal-session', () => session)

import { POST } from '@controller/app/api/(public)/certportal/auth/logout/route'

describe('POST /api/certportal/auth/logout', () => {
  it('clears the portal cookie for the forwarded host', async () => {
    const res = await POST(new NextRequest('http://localhost/api/certportal/auth/logout', { method: 'POST', headers: { 'x-forwarded-host': 'cert.example.com' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(session.clearPortalCookie).toHaveBeenCalledWith(expect.anything(), 'cert.example.com')
  })

  it('passes no host when neither header is present', async () => {
    await POST(new NextRequest('http://localhost/api/certportal/auth/logout', { method: 'POST' }))
    expect(session.clearPortalCookie).toHaveBeenLastCalledWith(expect.anything(), null)
  })
})
