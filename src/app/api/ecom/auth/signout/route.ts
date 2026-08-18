import { NextResponse } from 'next/server'
import { OWNER_COOKIE, ownerCookieOptions } from '@/lib/owner-session'

export async function POST() {
  const res = NextResponse.json({ message: 'Signed out' })
  res.cookies.set(OWNER_COOKIE, '', { ...ownerCookieOptions(), maxAge: 0 })
  return res
}
