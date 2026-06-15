import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateBusiness } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateBusiness(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Business user logged out' }).catch(() => {})
    }

    const cookieStore = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    // Expire both variants — modern (domain-scoped) and legacy host-only.
    cookieStore.set('business_auth_token', '', { ...baseOpts, ...cookieDomainOption() })
    cookieStore.set('business_auth_token', '', baseOpts)
    cookieStore.set('session_id', '', { ...baseOpts, ...cookieDomainOption() })
    cookieStore.set('session_id', '', baseOpts)

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
