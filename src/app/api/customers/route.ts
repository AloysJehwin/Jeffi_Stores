import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCustomers } from '@/lib/queries'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || undefined
    const status = searchParams.get('status') || undefined
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')

    const { customers, total } = await getCustomers({ search, status, page, limit })

    return NextResponse.json({ customers, total, page, limit })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
  }
}
