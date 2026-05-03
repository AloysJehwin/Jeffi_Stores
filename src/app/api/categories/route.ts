import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(_request: NextRequest) {

  const categories = await queryMany(
    'SELECT id, name, slug, parent_category_id, image_url, display_order FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC',
    []
  )

  return NextResponse.json({ categories: categories || [] })
}
