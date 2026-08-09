import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getGmcStatusPage, getGmcSummary } from '@/lib/merchant/gmc-status'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10)
  const search = searchParams.get('search') || undefined
  const status = searchParams.get('status') || undefined

  const [summary, { rows, total }] = await Promise.all([
    getGmcSummary(),
    getGmcStatusPage({ page, pageSize, search, status }),
  ])

  return NextResponse.json({ summary, rows, total, page, pageSize })
}
