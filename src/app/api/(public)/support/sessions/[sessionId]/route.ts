import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(`SELECT id FROM support_sessions WHERE id = $1 AND user_id = $2`, [
      sessionId,
      authUser.userId,
    ])
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    await query(`UPDATE support_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`, [sessionId])

    await query(`DELETE FROM websocket_connections WHERE session_id = $1`, [sessionId])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
