import { SignJWT, jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'
import { hasScope, getScopeForPath } from './scopes'
import { resolveSession, type SessionSignals } from './auth-sessions'
import { extractSessionSignals, ambientSessionSignals } from './session-signals-request'
import { adminCookieNameForHost } from './admin-cookie'

// OPAQUE SESSIONS: the auth cookie value is the session id (a uuid), NOT a JWT.
// authenticate*/verify* read the cookie and resolveSession() it (Postgres) — the single
// source of truth shared with the Node-runtime middleware. Legacy signed-JWT cookies
// (eyJ...) fail resolveSession's uuid guard → null → forced re-login. jose/JWT_SECRET
// remain only for the still-stateless review tokens.

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// Single source of truth for admin session lifetime (cookie maxAge + session TTL).
export const JWT_EXPIRES_IN = '8h'
export const JWT_MAX_AGE_S = 8 * 60 * 60

export interface JWTPayload {
  adminId: string
  first_name?: string
  last_name?: string
  email?: string
  displayName?: string
  role: string
  scopes: string[]
  authCertCN?: string
  tenantId?: string | null
  [key: string]: any
}

export interface UserJWTPayload {
  userId: string
  email: string
  isBusiness?: boolean
  approvalStatus?: string
  scopes?: string[]
  sid?: string
  [key: string]: any
}

export async function authenticateBusiness(request: NextRequest): Promise<UserJWTPayload | null> {
  const sid = getTokenFromRequest(request, 'business_sid')
  if (!sid) return null
  const s = await resolveSession(sid, extractSessionSignals(request))
  if (!s || s.principalType !== 'business') return null
  return {
    userId: s.principalId,
    email: s.email || '',
    isBusiness: true,
    approvalStatus: s.approvalStatus || undefined,
    scopes: s.scopes,
    sid,
  }
}

export interface AdminJWTPayload {
  adminId: string
  first_name?: string
  last_name?: string
  email?: string
  role: string
  scopes: string[]
  sid?: string
  [key: string]: any
}

export async function verifyToken(token: string, current?: string | null | SessionSignals): Promise<JWTPayload | null> {
  // Opaque admin-session resolve (token = the sid). Used by middleware + admin server
  // components. authCertCN comes from the snapshot on the session row. `current` carries the
  // request's device-binding signals (UA family, accept-language, sec-ch-ua-platform, ip, fp);
  // a bare string is accepted for back-compat and treated as the UA. On a clear multi-signal
  // mismatch resolveSession revokes the session (device binding).
  const s = await resolveSession(token, current === undefined ? await ambientSessionSignals() : current)
  if (!s || s.principalType !== 'admin') return null
  return {
    adminId: s.principalId,
    email: s.email || undefined,
    role: s.role || '',
    scopes: s.scopes,
    authCertCN: s.certCN || undefined,
    sid: s.sid,
    displayName: s.displayName || undefined,
    tenantId: s.tenantId,
  }
}

function getTokenFromRequest(request: NextRequest, cookieName: string): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7)
  }
  return request.cookies.get(cookieName)?.value || null
}

// Return the Authorization: Bearer value only (no cookie fallback). Used to gate the
// stateless extension-token path to Bearer requests, so a session cookie value can
// never be reinterpreted as a signed JWT.
function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7)
  return null
}

// Verify a scoped extension token (minted by POST /api/admin/token/generate). This is a
// STANDALONE signed JWT (not a session), so we jwtVerify it against JWT_SECRET and accept
// ONLY tokens tagged type='extension_token' — rejecting review/other JWTs from being
// replayed as admin. Returns an AdminJWTPayload (no sid) or null.
export async function verifyExtensionToken(token: string): Promise<AdminJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (payload.type !== 'extension_token') return null
    if (!payload.adminId) return null
    return {
      adminId: payload.adminId as string,
      email: (payload.email as string) || undefined,
      first_name: (payload.first_name as string) || undefined,
      last_name: (payload.last_name as string) || undefined,
      role: (payload.role as string) || '',
      scopes: Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [],
    }
  } catch {
    return null
  }
}

export async function authenticateUser(request: NextRequest): Promise<UserJWTPayload | null> {
  const sid = getTokenFromRequest(request, 'user_sid')
  if (!sid) return null
  const s = await resolveSession(sid, extractSessionSignals(request))
  if (!s || s.principalType !== 'customer') return null
  return { userId: s.principalId, email: s.email || '', scopes: s.scopes, sid }
}

// Authenticates regular users OR business users.
// Checks X-Auth-Portal header to determine which cookie to use:
//   X-Auth-Portal: business → ONLY tries business_sid (no customer fallback)
//   (default)               → tries user_sid first, then business_sid
// No cross-portal fallback when portal is explicit — prevents a user logged into both
// portals from having writes land on the wrong account if one token expires.
export async function authenticateAnyUser(request: NextRequest): Promise<UserJWTPayload | null> {
  const portal = request.headers.get('x-auth-portal')
  if (portal === 'business') {
    return await authenticateBusiness(request)
  }
  return (await authenticateUser(request)) ?? (await authenticateBusiness(request))
}

export async function requireAdminScope(
  request: NextRequest,
  scope: string | null
): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (scope && !hasScope(admin.role, admin.scopes, scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

export async function authenticateAdmin(request: NextRequest): Promise<AdminJWTPayload | null> {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const sid = getTokenFromRequest(request, adminCookieNameForHost(host))
  if (!sid) return null
  const s = await resolveSession(sid, extractSessionSignals(request))
  if (!s || s.principalType !== 'admin') {
    // Fallback: a scoped extension token (standalone JWT) sent via Authorization: Bearer.
    // Bearer-only — a session cookie value must never be reinterpreted as a JWT.
    const bearer = getBearerToken(request)
    if (bearer) {
      const ext = await verifyExtensionToken(bearer)
      if (ext) return ext
    }
    return null
  }
  const result: AdminJWTPayload = {
    adminId: s.principalId,
    email: s.email || undefined,
    role: s.role || '',
    scopes: s.scopes,
    sid,
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const mod = await import('./audit-context')
      mod.setAuditAdminId(result.adminId)
    } catch {}
  }
  return result
}

export interface ServiceAccountPayload {
  id: string
  name: string
  allowed_scopes: string[]
}

export async function authenticateServiceAccount(request: NextRequest): Promise<ServiceAccountPayload | null> {
  const certSerial = (request.headers.get('x-client-cert-serial') || '').trim()
  // Cert serials are hex strings. Reject anything that isn't.
  if (!certSerial || !/^[0-9a-fA-F]+$/.test(certSerial)) return null

  const { queryOne } = await import('./db')
  const sa = await queryOne<ServiceAccountPayload>(
    `SELECT id, name, allowed_scopes FROM service_accounts
     WHERE LOWER(serial_number) = $1 AND is_revoked = false`,
    [certSerial.toLowerCase()]
  )
  if (!sa) return null

  queryOne(`UPDATE service_accounts SET last_used_at = NOW() WHERE id = $1`, [sa.id]).catch(() => {})
  return sa
}

export async function requireUserScope(
  request: NextRequest,
  scope: string
): Promise<UserJWTPayload | NextResponse> {
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(user.scopes ?? []).includes(scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return user
}

export interface ReviewTokenPayload {
  orderId: string
  productId: string
  userId: string
}

export async function generateReviewToken(payload: ReviewTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'review_token' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('48h')
    .sign(JWT_SECRET)
}

export async function verifyUserToken(token: string, current?: string | null | SessionSignals): Promise<UserJWTPayload | null> {
  const s = await resolveSession(token, current === undefined ? await ambientSessionSignals() : current)
  if (!s || s.principalType !== 'customer') return null
  return { userId: s.principalId, email: s.email || '', scopes: s.scopes, sid: s.sid }
}

export async function verifyBusinessToken(token: string, current?: string | null | SessionSignals): Promise<UserJWTPayload | null> {
  const s = await resolveSession(token, current === undefined ? await ambientSessionSignals() : current)
  if (!s || s.principalType !== 'business') return null
  // Default unknown → 'pending' (fail-closed): the middleware gates pending/rejected, so
  // a session without a snapshotted status must NOT be treated as approved.
  return { userId: s.principalId, email: s.email || '', isBusiness: true, approvalStatus: s.approvalStatus || 'pending', scopes: s.scopes, sid: s.sid }
}

export async function verifyReviewToken(token: string): Promise<ReviewTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (payload.type !== 'review_token') return null
    if (!payload.orderId || !payload.productId || !payload.userId) return null
    return {
      orderId: payload.orderId as string,
      productId: payload.productId as string,
      userId: payload.userId as string,
    }
  } catch {
    return null
  }
}
