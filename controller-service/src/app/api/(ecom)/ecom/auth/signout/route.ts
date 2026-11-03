import { NextRequest, NextResponse } from 'next/server'
import { OWNER_COOKIE, ownerCookieOptions } from '@/lib/auth/owner-session'

export async function POST(request: NextRequest) {
  const res = NextResponse.json({ message: 'Signed out' })
  res.cookies.set(OWNER_COOKIE, '', { ...ownerCookieOptions(request.headers.get('x-forwarded-host') ?? request.headers.get('host')), maxAge: 0 })
  return res
}
