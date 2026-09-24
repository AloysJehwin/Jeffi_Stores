import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest, NextResponse } from 'next/server'

// Staff capture surface ({slug}.jeffistores.in/staff): an admin proves their email via OTP
// (no client certificate — this is for phones) and gets a short-lived signed JWT cookie.
// Host-scoped on purpose: it must never be valid on the mTLS admin host or any other tenant.

export const STAFF_COOKIE = 'staff_sid'
const STAFF_TTL_S = 8 * 60 * 60

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export interface StaffSession {
  adminId: string
  tenantId: string | null
  email: string
  name: string | null
  role: string
  scopes: string[]
}

export async function issueStaffToken(s: StaffSession): Promise<string> {
  return new SignJWT({ ...s, email: s.email.toLowerCase(), type: 'staff' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STAFF_TTL_S}s`)
    .sign(secret())
}

export async function verifyStaffToken(token: string | undefined | null): Promise<StaffSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (payload.type !== 'staff' || typeof payload.adminId !== 'string' || typeof payload.email !== 'string') return null
    return {
      adminId: payload.adminId,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
      role: typeof payload.role === 'string' ? payload.role : '',
      scopes: Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [],
    }
  } catch {
    return null
  }
}

/** Session from the request cookie, bound to the tenant of the current host. */
export async function staffSessionFromRequest(req: NextRequest, currentTenantId: string | null): Promise<StaffSession | null> {
  const s = await verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)
  if (!s) return null
  if ((s.tenantId ?? null) !== (currentTenantId ?? null)) return null
  return s
}

export function setStaffCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: STAFF_TTL_S,
    path: '/',
  })
  return res
}

export function clearStaffCookie(res: NextResponse): NextResponse {
  res.cookies.set(STAFF_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
