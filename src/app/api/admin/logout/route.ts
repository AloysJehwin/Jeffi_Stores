import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST() {
  try {
    const cookieStore = await cookies()
    cookieStore.delete({ name: 'admin_token', path: '/', ...cookieDomainOption() })
    return NextResponse.json({ message: 'Logged out' })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
