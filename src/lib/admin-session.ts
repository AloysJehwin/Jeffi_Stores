import { NextResponse } from 'next/server'
import { generateToken, JWT_MAX_AGE_S } from '@/lib/jwt'
import { createSession } from '@/lib/auth-sessions'
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
) {
  const displayName =
    `${admin.first_name || ''} ${admin.last_name || ''}`.trim() || admin.email || ''
  // Create a revocable server-side session; embed its id as the JWT `sid`.
  const { sid } = await createSession({
    principalType: 'admin',
    principalId: admin.id,
    ttlSeconds: JWT_MAX_AGE_S,
  })
  const token = await generateToken({
    adminId: admin.id,
    first_name: admin.first_name || undefined,
    last_name: admin.last_name || undefined,
    email: admin.email || undefined,
    role: admin.role,
    scopes: admin.scopes || [],
    authCertCN: certCN || undefined,
    sid,
  })
  const response = NextResponse.json({
    success: true,
    admin: { name: displayName, email: admin.email || undefined, role: admin.role },
    ...(extraBody || {}),
  })
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
    ...cookieDomainOption(),
  })
  return response
}
