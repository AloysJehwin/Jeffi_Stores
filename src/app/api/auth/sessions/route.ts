import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { listActiveSessions } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// List the caller's own active sessions.
export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await listActiveSessions('customer', auth.userId)
  return NextResponse.json({ sessions })
}
