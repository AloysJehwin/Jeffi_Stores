import { NextResponse } from 'next/server'
import { createSession, resolveSession, type SessionSignals } from '@/lib/auth/auth-sessions'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { findOrCreateOwner, getOwnerById, type Owner } from '@/lib/tenant-registry'

// Ecom store-owner sessions. Owners live in the CONTROL-PLANE `owners` table, but
// their session row lives in the app-DB auth_sessions (principal_type='owner'),
// reusing the existing opaque-token session engine (revocation, idle timeout,
// device binding). email/name are NOT joined by resolveSession for owners (they
// aren't in the app DB) — resolveOwnerSession enriches from the control plane.

export const OWNER_SESSION_TTL_S = 7 * 24 * 60 * 60 // 7 days
export const OWNER_COOKIE = 'owner_sid'

/** Create an owner (upsert by email) and issue an owner session; returns cookie sid. */
export async function issueOwnerSession(args: {
  email: string
  name?: string | null
  signals?: SessionSignals
}): Promise<{ sid: string; owner: Owner }> {
  const owner = await findOrCreateOwner(args.email.toLowerCase(), args.name ?? null)
  const { sid } = await createSession({
    principalType: 'owner',
    principalId: owner.id,
    ttlSeconds: OWNER_SESSION_TTL_S,
    userAgent: args.signals?.userAgent,
    ip: args.signals?.ip,
    acceptLanguage: args.signals?.acceptLanguage,
    uaPlatform: args.signals?.uaPlatform,
    fpHash: args.signals?.fpHash,
  })
  return { sid, owner }
}

/** Resolve an owner from the owner_sid cookie, or null. Enriches from control plane. */
export async function resolveOwnerSession(sid: string | undefined, signals?: SessionSignals): Promise<Owner | null> {
  if (!sid) return null
  const sess = await resolveSession(sid, signals).catch(() => null)
  if (!sess || sess.principalType !== 'owner') return null
  return getOwnerById(sess.principalId)
}

export function ownerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: OWNER_SESSION_TTL_S,
    path: '/',
    ...cookieDomainOption(),
  }
}

/** Set the owner session cookie on a response. */
export function setOwnerCookie(res: NextResponse, sid: string): NextResponse {
  res.cookies.set(OWNER_COOKIE, sid, ownerCookieOptions())
  return res
}
