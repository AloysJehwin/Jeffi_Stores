import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    // Clear auth token
    cookies().delete('auth_token')

    // Create new guest session
    const newGuestSessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    cookies().set('session_id', newGuestSessionId, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
