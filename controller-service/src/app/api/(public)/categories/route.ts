import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { categoryProductCounts } from '@/lib/catalog/storefront-counts'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  // ?counts=1: the /categories page's extras (description, icon, own active product count) for the app.
  const withCounts = new URL(request.url).searchParams.get('counts') === '1'
  const [categories, counts] = await Promise.all([
    queryMany<{ id: string }>(
      `SELECT id, name, slug, parent_category_id, image_url, display_order${withCounts ? ', description, icon_name' : ''}
       FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC`,
      []
    ),
    withCounts ? categoryProductCounts() : null,
  ])

  return NextResponse.json({
    categories: counts ? (categories || []).map(c => ({ ...c, product_count: counts[c.id] || 0 })) : categories || [],
  })
}
