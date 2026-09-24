import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { touchSession } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'

// The only thing that extends an admin's idle window besides real page and API use. A tab sends
// it when the admin actually interacted since the last beat, never on a timer. Self-service on
// the caller's own session, so no write scope applies.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin?.sid) return NextResponse.json({ authenticated: false }, { status: 401 })
  const d = await touchSession(admin.sid)
  if (!d) return NextResponse.json({ authenticated: false }, { status: 401 })
  return NextResponse.json({
    authenticated: true,
    deadlineAt: new Date(d.deadlineAt).getTime(),
    expiresAt: new Date(d.expiresAt).getTime(),
    serverNow: Date.now(),
  })
}
