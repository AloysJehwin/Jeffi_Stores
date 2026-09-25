import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { attributeValuesResponse } from '@/lib/product-attribute-filters.server'

export const dynamic = 'force-dynamic'

// Scope (products:read) is enforced by the middleware for /api/admin/products/*.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return attributeValuesResponse(request)
}
