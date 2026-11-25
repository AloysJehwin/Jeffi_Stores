import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/owner-session', () => ({
  OWNER_COOKIE: 'owner_sid',
  ownerCookieOptions: (host: string | null) => ({ path: '/', domain: host ?? undefined }),
}))

import { POST } from '@controller/app/api/(ecom)/ecom/auth/signout/route'

describe('POST /api/ecom/auth/signout', () => {
  it('clears the owner cookie for the forwarded host', async () => {
    const res = await POST(new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/signout', { method: 'POST', headers: { 'x-forwarded-host': 'ecom.jeffistores.in' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Signed out' })
    const cookie = res.cookies.get('owner_sid')
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
    expect(cookie?.domain).toBe('ecom.jeffistores.in')
  })
})
