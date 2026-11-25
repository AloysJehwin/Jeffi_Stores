import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockVerify, mockIssue } = vi.hoisted(() => ({ mockVerify: vi.fn(), mockIssue: vi.fn() }))

vi.mock('@/lib/shared/google-verify', () => ({ verifyGoogle: mockVerify }))
vi.mock('@/lib/auth/owner-session', () => ({
  issueOwnerSession: mockIssue,
  setOwnerCookie: (res: NextResponse, sid: string) => { res.cookies.set('owner_sid', sid); return res },
}))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({ ip: '1.1.1.1' }) }))

import { POST } from '@controller/app/api/(ecom)/ecom/auth/google/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/google', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/auth/google', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401s a token Google does not accept', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(req({ idToken: 'bad' }))
    expect(res.status).toBe(401)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('upserts the owner, issues a session and sets the cookie', async () => {
    mockVerify.mockResolvedValue({ email: 'o@acme.test', given_name: 'Priya', family_name: 'S' })
    mockIssue.mockResolvedValue({ sid: 'sid-1', owner: { id: 'o-1', email: 'o@acme.test', name: 'Priya S' } })
    const res = await POST(req({ idToken: 'good' }))
    expect(res.status).toBe(200)
    expect((await res.json()).owner).toEqual({ id: 'o-1', email: 'o@acme.test', name: 'Priya S' })
    expect(mockVerify).toHaveBeenCalledWith({ idToken: 'good', accessToken: undefined })
    expect(mockIssue).toHaveBeenCalledWith({ email: 'o@acme.test', name: 'Priya S', signals: { ip: '1.1.1.1' } })
    expect(res.cookies.get('owner_sid')?.value).toBe('sid-1')
  })

  it('500s when verification throws', async () => {
    mockVerify.mockRejectedValue(new Error('network'))
    expect((await POST(req({ idToken: 'x' }))).status).toBe(500)
  })
})
