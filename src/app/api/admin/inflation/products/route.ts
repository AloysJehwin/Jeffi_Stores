import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('category_id')
  if (!categoryId) return NextResponse.json({ error: 'category_id required' }, { status: 400 })

  const products = await queryMany(
    `SELECT id, name
     FROM products
     WHERE category_id = ANY(
       SELECT id FROM categories WHERE id = $1
       UNION
       SELECT id FROM categories WHERE parent_category_id = $1
     ) AND is_active = true
     ORDER BY name`,
    [categoryId]
  )

  return NextResponse.json({ products: products || [] })
}
