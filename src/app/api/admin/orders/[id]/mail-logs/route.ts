import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const logs = await queryMany<any>(
      `SELECT id, email, from_email, subject, template_name, kind, status, error, message_id, sent_at
       FROM email_logs
       WHERE entity_type = 'orders' AND entity_id = $1
       ORDER BY sent_at DESC`,
      [id]
    )

    return NextResponse.json({ logs: logs || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
