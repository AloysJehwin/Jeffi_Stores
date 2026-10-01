import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { attributeValuesResponse } from '@/lib/catalog/product-attribute-filters'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'controls:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return attributeValuesResponse(request)
}
