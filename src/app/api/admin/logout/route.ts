import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    cookieStore.set('admin_token', '', { ...baseOpts, ...cookieDomainOption() })
    cookieStore.set('admin_token', '', baseOpts)
    return NextResponse.json({ message: 'Logged out' })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
