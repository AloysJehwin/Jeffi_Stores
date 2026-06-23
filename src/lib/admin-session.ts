import { NextResponse } from 'next/server'
import { generateToken, JWT_MAX_AGE_S } from '@/lib/jwt'
import { cookieDomainOption } from '@/lib/cookie-domain'

export interface AdminSessionAdmin {
  id: string
  username: string
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
  const token = await generateToken({
    adminId: admin.id,
    username: admin.username,
    first_name: admin.first_name || undefined,
    last_name: admin.last_name || undefined,
    role: admin.role,
    scopes: admin.scopes || [],
    authCertCN: certCN || undefined,
  })
  const response = NextResponse.json({
    success: true,
    admin: { username: admin.username, role: admin.role },
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
