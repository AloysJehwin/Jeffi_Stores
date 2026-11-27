import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { pageProposedTools } from '@/lib/admin-agent/proposed-tools-list'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = (url.searchParams.get('status') || 'proposed').toLowerCase()
  const pageSize = Math.min(
    parseInt(url.searchParams.get('pageSize') || url.searchParams.get('limit') || '25', 10),
    200
  )
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const { items, total } = await pageProposedTools(status, pageSize, page)

  return NextResponse.json({ items, total, page, pageSize })
}
