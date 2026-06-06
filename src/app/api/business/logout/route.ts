import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateBusiness } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateBusiness(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Business user logged out' }).catch(() => {})
    }

    const cookieStore = await cookies()
    cookieStore.delete('business_auth_token')

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
