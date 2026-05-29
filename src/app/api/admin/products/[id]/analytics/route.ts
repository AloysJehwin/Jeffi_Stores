import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getProductAnalyticsData } from '@/lib/admin-product-analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') || '30'), 1), 365)
  const data = await getProductAnalyticsData(params.id, days)
  if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  return NextResponse.json(data)
}
