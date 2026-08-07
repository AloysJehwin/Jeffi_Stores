import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { listActiveSessions } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// List the caller's own active business sessions.
export async function GET(request: NextRequest) {
  const auth = await authenticateBusiness(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await listActiveSessions('business', auth.userId)
  return NextResponse.json({ sessions })
}
