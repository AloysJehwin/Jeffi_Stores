import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getProductAnalyticsData } from '@/lib/shared/admin-product-analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') || '30'), 1), 365)
  const data = await getProductAnalyticsData(id, days)
  if (!data) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  return NextResponse.json(data)
}
