import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, JWT_MAX_AGE_S } from '@/lib/jwt'
import { extendSession } from '@/lib/auth-sessions'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin || !admin.sid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Opaque sessions: "refresh" slides the same session's expiry forward and re-sets the
  // cookie (same sid value). No new session row, no new token.
  await extendSession(admin.sid, JWT_MAX_AGE_S)

  const response = NextResponse.json({ success: true })
  response.cookies.set('admin_sid', admin.sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_MAX_AGE_S,
    path: '/',
    ...cookieDomainOption(),
  })
  return response
}

