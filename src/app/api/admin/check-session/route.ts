import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export async function GET() {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('admin_token')

    if (!token) {
      return NextResponse.json({ authenticated: false })
    }

    const payload = await verifyToken(token.value)

    if (!payload) {
      return NextResponse.json({ authenticated: false })
    }

    return NextResponse.json({ authenticated: true, user: payload })
  } catch (error) {
    return NextResponse.json({ authenticated: false })
  }
}
