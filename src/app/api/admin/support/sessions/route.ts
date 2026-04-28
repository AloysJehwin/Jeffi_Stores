import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessions = await queryMany(
      `SELECT ss.id, ss.user_id, ss.created_at, ss.admin_name,
              CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
              u.email AS customer_email
       FROM support_sessions ss
       JOIN users u ON u.id = ss.user_id
       WHERE ss.status = 'open'
       ORDER BY ss.created_at ASC`,
      []
    )

    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
