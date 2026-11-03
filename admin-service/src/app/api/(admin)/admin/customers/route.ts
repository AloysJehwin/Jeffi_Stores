import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { parseSort } from '@jeffi/list-filters'
import { getCustomers } from '@/lib/queries'
import { CUSTOMERS_ENTITY } from '@/lib/filters/entities/customers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const segment = searchParams.get('segment') || undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)

  const sort = parseSort(searchParams, CUSTOMERS_ENTITY.sorts)

  const { customers } = await getCustomers({ segment, limit, sort: sort?.key ?? 'lifetime_value', dir: sort?.dir ?? 'desc' })
  return NextResponse.json({ customers })
}
