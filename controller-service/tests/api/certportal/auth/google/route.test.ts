import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const google = vi.hoisted(() => ({ verifyGoogle: vi.fn() }))
vi.mock('@/lib/shared/google-verify', () => google)
const session = vi.hoisted(() => ({ issuePortalToken: vi.fn(), setPortalCookie: vi.fn() }))
vi.mock('@/lib/auth/portal-session', () => session)

import { POST } from '@controller/app/api/(public)/certportal/auth/google/route'

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/certportal/auth/google', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  google.verifyGoogle.mockResolvedValue({ email: 'Admin@Example.com', name: 'Ada Admin' })
  session.issuePortalToken.mockResolvedValue('tok')
  session.setPortalCookie.mockImplementation((res: Response) => res)
})

describe('POST /api/certportal/auth/google', () => {
  it('rejects a token Google does not vouch for', async () => {
    google.verifyGoogle.mockResolvedValue(null)
    const res = await call({ idToken: 'bad' })
    expect(res.status).toBe(401)
    expect(session.issuePortalToken).not.toHaveBeenCalled()
  })

  it('rejects an identity with no email', async () => {
    google.verifyGoogle.mockResolvedValue({ name: 'x' })
    expect((await call({ idToken: 't' })).status).toBe(401)
  })

  it('signs in, issuing a portal token and cookie for the verified email', async () => {
    const res = await call({ idToken: 'good' }, { 'x-forwarded-host': 'certificate.example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'admin@example.com', name: 'Ada Admin' })
    expect(session.issuePortalToken).toHaveBeenCalledWith('Admin@Example.com', 'Ada Admin')
    expect(session.setPortalCookie).toHaveBeenCalledWith(expect.anything(), 'tok', 'certificate.example.com')
  })

  it('builds the name from given and family names', async () => {
    google.verifyGoogle.mockResolvedValue({ email: 'a@b.co', given_name: 'Ada', family_name: 'Lovelace' })
    expect((await (await call({ accessToken: 't' })).json()).name).toBe('Ada Lovelace')
  })

  it('answers 500 when verification throws', async () => {
    google.verifyGoogle.mockRejectedValue(new Error('network'))
    expect((await call({ idToken: 't' })).status).toBe(500)
  })

  it('answers 500 for an unreadable body', async () => {
    expect((await call('not json')).status).toBe(500)
  })
})
