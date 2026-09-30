import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'customers:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const session = await queryOne<{
      id: string
      status: string
      created_at: string
      admin_name: string | null
      last_activity_at: string
    }>(
      `SELECT ss.id, ss.status, ss.created_at, ss.admin_name,
              GREATEST(ss.created_at, COALESCE(MAX(sm.created_at), ss.created_at)) AS last_activity_at
       FROM support_sessions ss
       LEFT JOIN support_messages sm ON sm.session_id = ss.id
       WHERE ss.user_id = $1 AND ss.status = 'open'
       GROUP BY ss.id, ss.status, ss.created_at, ss.admin_name
       ORDER BY ss.created_at DESC LIMIT 1`,
      [userId]
    )

    if (!session) {
      return NextResponse.json({ session: null })
    }

    // Server-authoritative staleness check so the admin's clock/env can't skew it.
    const staleMs = parseInt(process.env.SUPPORT_STALE_CLOSE_MS || '3600000', 10)
    const idleMs = Date.now() - new Date(session.last_activity_at).getTime()
    const staleForClose = idleMs >= staleMs

    return NextResponse.json({ session: { ...session, staleForClose } })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
