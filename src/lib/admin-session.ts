import { NextResponse } from 'next/server'
import { JWT_MAX_AGE_S } from '@/lib/jwt'
import { createSession, type SessionSignals } from '@/lib/auth-sessions'
import { cookieDomainOption } from '@/lib/cookie-domain'

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
  signals?: SessionSignals,
) {
  const displayName =
    `${admin.first_name || ''} ${admin.last_name || ''}`.trim() || admin.email || ''
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
    userAgent: signals?.userAgent || null,
    ip: signals?.ip || null,
    acceptLanguage: signals?.acceptLanguage || null,
    uaPlatform: signals?.uaPlatform || null,
    fpHash: signals?.fpHash || null,
  })
  const response = NextResponse.json({
    success: true,
    admin: { name: displayName, email: admin.email || undefined, role: admin.role },
    ...(extraBody || {}),
  })
  response.cookies.set('admin_sid', sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
    ...cookieDomainOption(),
  })
  return response
}
