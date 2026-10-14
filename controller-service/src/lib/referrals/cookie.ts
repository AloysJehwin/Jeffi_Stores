import type { NextRequest, NextResponse } from 'next/server'

// Set by /r/<code>, read once by signup. httpOnly: only the server ever needs it.
export const REFERRAL_COOKIE = 'ref_code'
const MAX_AGE_S = 30 * 24 * 60 * 60

export function setReferralCookie(res: NextResponse, code: string): void {
  res.cookies.set(REFERRAL_COOKIE, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_S,
    path: '/',
  })
}

// Route handlers get a NextRequest; tests and some callers pass a plain Request, so fall back to
// the raw Cookie header when there is no parsed jar.
export function readReferralCookie(req: NextRequest | Request): string | null {
  const jar = (req as NextRequest).cookies
  if (jar && typeof jar.get === 'function') return jar.get(REFERRAL_COOKIE)?.value || null
  const match = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)ref_code=([^;]*)/)
  return match ? decodeURIComponent(match[1]) || null : null
}

// Accepts a response's cookie jar or next/headers cookies(); both expose the same set().
interface CookieJar {
  set(name: string, value: string, options: { httpOnly: boolean; sameSite: 'lax'; maxAge: number; path: string }): unknown
}

export function clearReferralCookie(jar: CookieJar): void {
  jar.set(REFERRAL_COOKIE, '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' })
}
