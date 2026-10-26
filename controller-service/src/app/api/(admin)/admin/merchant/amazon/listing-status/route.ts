import { NextRequest, NextResponse } from 'next/server'
import { normalizeQuery } from '@jeffi/list-filters'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getAmazonStatusPage, getAmazonSummary } from '@/lib/amazon/status'
import { AMAZON_LISTINGS_ENTITY } from '@/lib/filters/entities/amazon-listings'

export const dynamic = 'force-dynamic'

// One page of listings plus the summary cards, both over the listings tab's filters.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'merchant_sync:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10)
  const filters = normalizeQuery(AMAZON_LISTINGS_ENTITY, searchParams)

  const [summary, { rows, total }] = await Promise.all([
    getAmazonSummary(filters),
    getAmazonStatusPage({ page, pageSize, filters }),
  ])

  return NextResponse.json({ summary, rows, total, page, pageSize })
}
