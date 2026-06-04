import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, generateToken } from '@/lib/jwt'

const JWT_MAX_AGE_S = 60 // must match JWT_EXPIRES_IN in jwt.ts

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await generateToken({
    adminId: admin.adminId,
    username: admin.username,
    first_name: admin.first_name,
    last_name: admin.last_name,
    role: admin.role,
    scopes: admin.scopes,
  })

  const response = NextResponse.json({ success: true })
  response.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
  })
  return response
}

