import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listReturnRequests } from '@/lib/admin/return-requests'

// ?bucket=all|pending_approval|history&filter=all|approved|rejected, the list filters, page / limit.
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { rows, total, page, limit, hasMore } = await listReturnRequests('replacement', new URL(request.url).searchParams)
    return NextResponse.json({ replacements: rows, total, page, limit, hasMore })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch replacements' }, { status: 500 })
  }
}
