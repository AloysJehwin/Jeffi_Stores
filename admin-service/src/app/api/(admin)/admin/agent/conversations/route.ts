import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listConversations } from '@/lib/admin-agent/conversations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get('limit') || '30', 10) || 30, 100)
  const rows = await listConversations(admin.adminId, limit)
  // `preview` kept for older clients.
  return NextResponse.json({ items: rows.map(r => ({ ...r, preview: r.title })) })
}
