import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'

// Admin-side close for stale sessions. Customers normally close their own
// sessions, but many never do after an end-session request — so once a session
// has had no activity for SUPPORT_STALE_CLOSE_MS (default 1h) the admin may
// close it. Staleness is re-checked here so the client can't force an early close.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'customers:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { status } = await request.json()
    if (status !== 'closed') {
      return NextResponse.json({ error: 'Only closing a session is supported' }, { status: 400 })
    }

    const session = await queryOne<{ id: string; user_id: string; last_activity_at: string }>(
      `SELECT ss.id, ss.user_id,
              GREATEST(ss.created_at, COALESCE(MAX(sm.created_at), ss.created_at)) AS last_activity_at
       FROM support_sessions ss
       LEFT JOIN support_messages sm ON sm.session_id = ss.id
       WHERE ss.id = $1 AND ss.status = 'open'
       GROUP BY ss.id, ss.user_id, ss.created_at`,
      [sessionId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found or already closed' }, { status: 404 })
    }

    const staleMs = parseInt(process.env.SUPPORT_STALE_CLOSE_MS || '3600000', 10)
    const idleMs = Date.now() - new Date(session.last_activity_at).getTime()
    if (idleMs < staleMs) {
      return NextResponse.json(
        { error: 'Session is still active and can only be closed by the customer' },
        { status: 409 }
      )
    }

    await query(`UPDATE support_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`, [sessionId])
    await query(`DELETE FROM websocket_connections WHERE session_id = $1`, [sessionId])

    logActivity({
      userId: session.user_id,
      actorId: admin.adminId,
      kind: 'support_message',
      referenceId: sessionId,
      referenceType: 'support_sessions',
      summary: 'Admin closed inactive support session',
      metadata: { from: 'admin', reason: 'stale', idleMs },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
