import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Logged out' }).catch(() => {})
    }

    const store = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    // Expire both variants — modern (domain-scoped) and legacy host-only.
    store.set('auth_token', '', { ...baseOpts, ...cookieDomainOption() })
    store.set('auth_token', '', baseOpts)
    store.set('session_id', '', { ...baseOpts, ...cookieDomainOption() })
    store.set('session_id', '', baseOpts)

    const newGuestSessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    store.set('session_id', newGuestSessionId, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
      ...cookieDomainOption(),
    })

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
