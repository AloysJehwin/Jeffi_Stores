import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest, NextResponse } from 'next/server'

// Staff capture surface ({slug}.jeffistores.in/staff): an admin proves their email via OTP
// (no client certificate — this is for phones) and gets a short-lived signed JWT cookie.
// Host-scoped on purpose: it must never be valid on the mTLS admin host or any other tenant.
// The cookie carries identity only. Role and scopes are read from the admin record per request:
// an owner's scope list made the Set-Cookie header overflow nginx's header buffer (502).

export const STAFF_COOKIE = 'staff_sid'
const STAFF_TTL_S = 8 * 60 * 60

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export interface StaffTokenClaims {
  adminId: string
  tenantId: string | null
  email: string
  name: string | null
}

export interface StaffSession extends StaffTokenClaims {
  role: string
  scopes: string[]
}

export async function issueStaffToken(c: StaffTokenClaims): Promise<string> {
  return new SignJWT({
    adminId: c.adminId,
    tenantId: c.tenantId,
    email: c.email.toLowerCase(),
    name: c.name,
    type: 'staff',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STAFF_TTL_S}s`)
    .sign(secret())
}

export async function verifyStaffToken(token: string | undefined | null): Promise<StaffTokenClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (payload.type !== 'staff' || typeof payload.adminId !== 'string' || typeof payload.email !== 'string')
      return null
    return {
      adminId: payload.adminId,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
    }
  } catch {
    return null
  }
}

/** Claims from the request cookie, bound to the tenant of the current host. */
export async function staffSessionFromRequest(
  req: NextRequest,
  currentTenantId: string | null
): Promise<StaffTokenClaims | null> {
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
