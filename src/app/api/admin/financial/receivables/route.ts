import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getReceivablesAging } from '@/lib/financial'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const customerPhone = searchParams.get('customerPhone') || ''
    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)

    const result = await getReceivablesAging({
      from: from || undefined,
      to: to || undefined,
      customerPhone: customerPhone || undefined,
      search: search || undefined,
      page,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
