import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id FROM support_sessions WHERE id = $1 AND user_id = $2`,
      [params.sessionId, authUser.userId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    await query(
      `UPDATE support_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`,
      [params.sessionId]
    )

    await query(
      `DELETE FROM websocket_connections WHERE session_id = $1`,
      [params.sessionId]
    )

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
