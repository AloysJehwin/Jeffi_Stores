import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { DEFAULT_ADMIN_IDLE_MINUTES } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'

// The signed-in admin's idle window, for the client idle watcher. Returns the effective timeout
// (their per-account value or the default) so the watcher can proactively redirect to login at the
// deadline. Server-side enforcement in resolveSession is the real gate; this just lets an open tab
// bounce itself without waiting for the next request.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ idle_timeout_minutes: number | null }>(
    `SELECT idle_timeout_minutes FROM admins WHERE id = $1`,
    [admin.adminId]
  )
  const idleMinutes = row?.idle_timeout_minutes ?? DEFAULT_ADMIN_IDLE_MINUTES
  return NextResponse.json({ idleMinutes })
}
