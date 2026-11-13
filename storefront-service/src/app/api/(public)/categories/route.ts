import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'
import { categoryProductCounts } from '@/lib/catalog/storefront-counts'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

// ?slug=: one category's page profile (docs/BRAND_CATEGORY_PLAN.md §3.2) with its published FAQs, for the app.
const CATEGORY_DETAIL_COLUMNS = [
  'id', 'name', 'slug', 'parent_category_id', 'image_url', 'display_order', 'description', 'icon_name',
  'hero_image_desktop', 'hero_image_mobile', 'short_name', 'tagline', 'show_in_nav', 'is_featured',
  'banner_link_url', 'default_sort', 'listing_layout', 'seo_content', 'non_returnable_reason', 'cod_allowed',
].join(', ')

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const slug = params.get('slug')
  if (slug) {
    const category = await queryOne<{ id: string }>(
      `SELECT ${CATEGORY_DETAIL_COLUMNS} FROM categories WHERE slug = $1 AND is_active = true LIMIT 1`,
      [slug]
    )
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    const faqs = await queryMany(
      `SELECT id, question, answer FROM category_faqs
        WHERE category_id = $1 AND published = true ORDER BY sort_order ASC, created_at ASC`,
      [category.id]
    )
    return NextResponse.json({ category: { ...category, faqs } })
  }

  // ?counts=1: the /categories page's extras (description, icon, tagline, menu flags, own active product count) for the app.
  const withCounts = params.get('counts') === '1'
  const [categories, counts] = await Promise.all([
    queryMany<{ id: string }>(
      `SELECT id, name, slug, parent_category_id, image_url, display_order${
        withCounts ? ', description, icon_name, short_name, tagline, show_in_nav, is_featured' : ''
      }
       FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC`,
      []
    ),
    withCounts ? categoryProductCounts() : null,
  ])

  return NextResponse.json({
    categories: counts ? (categories || []).map(c => ({ ...c, product_count: counts[c.id] || 0 })) : categories || [],
  })
}
