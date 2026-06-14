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

    const store = cookies()
    // Delete both variants — modern cookies set with domain=.jeffistores.in
    // and any legacy host-only cookies that pre-date the cookie-domain fix.
    store.delete({ name: 'auth_token', path: '/', ...cookieDomainOption() })
    store.delete({ name: 'auth_token', path: '/' })
    store.delete({ name: 'session_id', path: '/', ...cookieDomainOption() })
    store.delete({ name: 'session_id', path: '/' })

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
