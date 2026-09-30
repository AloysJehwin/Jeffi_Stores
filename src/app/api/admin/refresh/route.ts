import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, JWT_MAX_AGE_S } from '@/lib/jwt'
import { extendSession } from '@/lib/auth-sessions'
import { adminCookieName, adminCookieDomain } from '@/lib/admin-cookie'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin || !admin.sid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Opaque sessions: "refresh" slides the same session's expiry forward and re-sets the
  // cookie (same sid value). No new session row, no new token.
  await extendSession(admin.sid, JWT_MAX_AGE_S)

  const response = NextResponse.json({ success: true })
  response.cookies.set(await adminCookieName(), admin.sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
    ...(await adminCookieDomain()),
  })
  return response
}
