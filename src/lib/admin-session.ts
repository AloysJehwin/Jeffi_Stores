import { NextResponse } from 'next/server'
import { generateToken } from '@/lib/jwt'

export interface AdminSessionAdmin {
  id: string
  username: string
  first_name?: string | null
  last_name?: string | null
  role: string
  scopes?: string[] | null
}

export async function issueAdminSession(admin: AdminSessionAdmin, certCN?: string) {
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
  })
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  })
  return response
}
