import { NextResponse } from 'next/server'
import { JWT_MAX_AGE_S } from '@/lib/auth/jwt'
import { createSession, type SessionSignals } from '@/lib/auth/auth-sessions'
import { adminCookieName, adminCookieDomain } from '@/lib/auth/admin-cookie'
import { resolveRequestTenantId } from '@/lib/tenancy/request-tenant'
import { query } from '@/lib/shared/db'

export interface AdminSessionAdmin {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  role: string
  scopes?: string[] | null
}

export async function issueAdminSession(
  admin: AdminSessionAdmin,
  certCN?: string,
  extraBody?: Record<string, unknown>,
  signals?: SessionSignals
) {
  const displayName = `${admin.first_name || ''} ${admin.last_name || ''}`.trim() || admin.email || ''
  // Opaque server-side session: the cookie value is the session id (a uuid), NOT a JWT.
  // role/scopes/cert_cn are snapshotted onto the row for the Node middleware's gate.
  // Device-binding signals (UA family, accept-language, sec-ch-ua-platform, ip network, fp
  // hash) are snapshotted too — resolveSession revokes on a clear multi-signal mismatch.
  const { sid } = await createSession({
    principalType: 'admin',
    principalId: admin.id,
    ttlSeconds: JWT_MAX_AGE_S,
    role: admin.role,
    scopes: admin.scopes || [],
    certCN: certCN || null,
    tenantId: await resolveRequestTenantId(),
    userAgent: signals?.userAgent || null,
    ip: signals?.ip || null,
    acceptLanguage: signals?.acceptLanguage || null,
    uaPlatform: signals?.uaPlatform || null,
    fpHash: signals?.fpHash || null,
  })
  // Stamp the real admin login time. Nothing wrote admins.last_login before, so the team page
  // showed it blank/stale; this is the single choke point every completed admin login passes.
  await query(`UPDATE admins SET last_login = NOW() WHERE id = $1`, [admin.id]).catch(() => {})
  const response = NextResponse.json({
    success: true,
    admin: { name: displayName, email: admin.email || undefined, role: admin.role },
    ...(extraBody || {}),
  })
  response.cookies.set(await adminCookieName(), sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
    ...(await adminCookieDomain()),
  })
  return response
}
