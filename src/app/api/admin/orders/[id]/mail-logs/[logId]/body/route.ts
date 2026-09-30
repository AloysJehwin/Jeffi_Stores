import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; logId: string }> }) {
  try {
    const { id, logId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const row = await queryOne<{ body_html: string | null }>(
      `SELECT body_html FROM email_logs WHERE id = $1 AND entity_type = 'orders' AND entity_id = $2`,
      [logId, id]
    )

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ html: row.body_html })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
