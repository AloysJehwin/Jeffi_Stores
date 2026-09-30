import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { decodeJwt } from 'jose'
import {
  issueStaffToken,
  verifyStaffToken,
  staffSessionFromRequest,
  setStaffCookie,
  STAFF_COOKIE,
} from '@/lib/staff-session'
import { NextResponse } from 'next/server'

const claims = {
  adminId: '1e99c629-fa38-41bb-a693-6686b3f45b88',
  tenantId: null,
  email: 'Owner@Example.com',
  name: 'Store Owner',
}

describe('staff-session', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing'
  })

  it('round-trips identity claims with a lower-cased email', async () => {
    const token = await issueStaffToken(claims)
    expect(await verifyStaffToken(token)).toEqual({ ...claims, email: 'owner@example.com' })
  })

  it('never puts role or scopes in the cookie, so the header stays small however many scopes the admin holds', async () => {
    const seventySevenScopes = Array.from({ length: 77 }, (_, i) => `area${i}:write`)
    const token = await issueStaffToken({ ...claims, role: 'administrator', scopes: seventySevenScopes } as never)
    const payload = decodeJwt(token)
    expect(payload).not.toHaveProperty('scopes')
    expect(payload).not.toHaveProperty('role')
    expect(token.length).toBeLessThan(500)
  })

  it('rejects a tampered or foreign token', async () => {
    const token = await issueStaffToken(claims)
    expect(await verifyStaffToken(token.slice(0, -3) + 'abc')).toBeNull()
    expect(await verifyStaffToken('not-a-jwt')).toBeNull()
    expect(await verifyStaffToken(undefined)).toBeNull()
  })

  it('binds the cookie to the tenant of the current host', async () => {
    const token = await issueStaffToken({ ...claims, tenantId: 'tenant-a' })
    const req = new NextRequest('https://a.example.com/api/staff/me')
    req.cookies.set(STAFF_COOKIE, token)
    expect(await staffSessionFromRequest(req, 'tenant-a')).toMatchObject({
      adminId: claims.adminId,
      tenantId: 'tenant-a',
    })
    expect(await staffSessionFromRequest(req, 'tenant-b')).toBeNull()
    expect(await staffSessionFromRequest(req, null)).toBeNull()
  })

  it('sets an httpOnly, strict cookie', async () => {
    const res = setStaffCookie(NextResponse.json({ ok: true }), 'tok')
    const c = res.cookies.get(STAFF_COOKIE)
    expect(c).toMatchObject({ value: 'tok', httpOnly: true, sameSite: 'strict', path: '/' })
  })
})
