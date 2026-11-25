import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const verifyGoogle = vi.hoisted(() => vi.fn())
const resolveAdminByEmail = vi.hoisted(() => vi.fn())
const hasPlanScope = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
const issueStaffToken = vi.hoisted(() => vi.fn())
const setStaffCookie = vi.hoisted(() => vi.fn())

vi.mock('@/lib/shared/google-verify', () => ({ verifyGoogle }))
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail }))
vi.mock('@/lib/auth/plan-gate', () => ({ hasPlanScope }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/auth/staff-session', () => ({ issueStaffToken, setStaffCookie }))

import { POST } from '@storefront/app/api/(public)/staff/auth/google/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/staff/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('POST /api/staff/auth/google', () => {
  beforeEach(() => {
    verifyGoogle.mockResolvedValue({ email: 'staff@x.test', name: 'G Name' })
    resolveAdminByEmail.mockResolvedValue({ id: 'a1', email: 'staff@x.test', role: 'staff', scopes: [], first_name: 'Ravi', last_name: null })
    hasPlanScope.mockResolvedValue(true)
    resolveTenantId.mockResolvedValue('t1')
    issueStaffToken.mockResolvedValue('staff-token')
    setStaffCookie.mockImplementation((res: NextResponse, token: string) => {
      res.headers.set('x-test-cookie', token)
      return res
    })
  })

  it('401s on an unverifiable Google token (including an unparseable body)', async () => {
    verifyGoogle.mockResolvedValue(null)
    expect((await post({ idToken: 'bad' })).status).toBe(401)
    expect((await post('{bad')).status).toBe(401)
    expect(issueStaffToken).not.toHaveBeenCalled()
  })

  it('404s when the Google email is not an admin of this store', async () => {
    resolveAdminByEmail.mockResolvedValue(null)
    expect((await post({ idToken: 't' })).status).toBe(404)
  })

  it('403s when the role or plan cannot write customer notes', async () => {
    hasPlanScope.mockResolvedValue(false)
    expect((await post({ idToken: 't' })).status).toBe(403)
    expect(issueStaffToken).not.toHaveBeenCalled()
  })

  it('issues the staff session cookie for a permitted admin', async () => {
    const res = await post({ idToken: 'good' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'Ravi' })
    expect(verifyGoogle).toHaveBeenCalledWith({ idToken: 'good', accessToken: undefined })
    expect(issueStaffToken).toHaveBeenCalledWith({ adminId: 'a1', tenantId: 't1', email: 'staff@x.test', name: 'Ravi' })
    expect(res.headers.get('x-test-cookie')).toBe('staff-token')
  })

  it('falls back to the Google name when the admin has none', async () => {
    resolveAdminByEmail.mockResolvedValue({ id: 'a1', email: 'staff@x.test', role: 'staff', scopes: [], first_name: null, last_name: null })
    expect((await (await post({ idToken: 'good' })).json()).name).toBe('G Name')
  })

  it('500s on an unexpected error', async () => {
    issueStaffToken.mockRejectedValue(new Error('jwt'))
    expect((await post({ idToken: 'good' })).status).toBe(500)
  })
})
