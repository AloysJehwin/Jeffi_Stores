import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category_id')
  const brandId = searchParams.get('brand_id') || null
  if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })

  const params: unknown[] = [categoryId]
  let brandClause = ''
  if (brandId) {
    params.push(brandId)
    brandClause = `AND p.brand_id = $${params.length}`
  }

  const products = await queryMany(
    `SELECT p.id, p.name, p.brand_id, b.name AS brand_name
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.category_id = ANY(
       SELECT id FROM categories WHERE id = $1
       UNION
       SELECT id FROM categories WHERE parent_category_id = $1
     ) AND p.is_active = true ${brandClause}
     ORDER BY p.name`,
    params
  )

  return NextResponse.json({ products: products || [] })
}
