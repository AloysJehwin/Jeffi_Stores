import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Logged out' }).catch(() => {})
    }

    cookies().delete('auth_token')

    const newGuestSessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    cookies().set('session_id', newGuestSessionId, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
