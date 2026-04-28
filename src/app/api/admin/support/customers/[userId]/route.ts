import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id, status, created_at FROM support_sessions
       WHERE user_id = $1 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [params.userId]
    )

    return NextResponse.json({ session: session || null })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
