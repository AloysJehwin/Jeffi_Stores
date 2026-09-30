import { SignJWT, jwtVerify } from 'jose'
import type { NextResponse } from 'next/server'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'

// certificate.jeffistores.in session. The portal is a shared control-plane host with no per-store
// DB, and it only needs to know WHICH verified email is signed in (to list that person's certs and
// gate their one-time download). So the session is a short-lived signed JWT in a cookie — no
// session row. The email is re-provable via Google at any time; the cookie just avoids re-auth on
// every page.

export const PORTAL_COOKIE = 'cert_portal'
const PORTAL_TTL_S = 30 * 60 // 30 minutes — long enough to download, short because it grants cert access

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export interface PortalSession {
  email: string
  name: string | null
}

export async function issuePortalToken(email: string, name: string | null): Promise<string> {
  return new SignJWT({ email: email.toLowerCase(), name, type: 'cert_portal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PORTAL_TTL_S}s`)
    .sign(secret())
}

export async function verifyPortalToken(token: string | undefined | null): Promise<PortalSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (payload.type !== 'cert_portal' || typeof payload.email !== 'string') return null
    return { email: payload.email, name: (payload.name as string) ?? null }
  } catch {
    return null
  }
}

export function setPortalCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: PORTAL_TTL_S,
    path: '/',
    ...cookieDomainOption(),
  })
  return res
}

export function clearPortalCookie(res: NextResponse): NextResponse {
  res.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0, ...cookieDomainOption() })
  return res
}
