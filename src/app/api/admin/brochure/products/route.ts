import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getBrochureProductsByCategories, getBrochureProductsByBrands } from '@/lib/queries'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lists the products that a brochure section-1 selection resolves to, for the
 * popup's section-2 live product list. Pass either categoryIds (categories-page
 * mode) or brandIds (brands-page mode) as repeated query params.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'products:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const categoryIds = sp.getAll('categoryIds').filter(v => UUID_RE.test(v))
    const brandIds = sp.getAll('brandIds').filter(v => UUID_RE.test(v))

    if (categoryIds.length === 0 && brandIds.length === 0) {
      return NextResponse.json({ products: [] })
    }

    // Category mode takes precedence when both are somehow present; the popup
    // only ever sends one axis per its page mode.
    const products =
      categoryIds.length > 0
        ? await getBrochureProductsByCategories(categoryIds)
        : await getBrochureProductsByBrands(brandIds)

    return NextResponse.json({ products })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list products' }, { status: 500 })
  }
}
