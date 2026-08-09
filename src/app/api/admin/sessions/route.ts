import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { listActiveSessions } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// List the logged-in admin's own active sessions.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await listActiveSessions('admin', admin.adminId)
  return NextResponse.json({ sessions })
}
