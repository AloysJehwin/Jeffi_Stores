import { NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

type Row = { id: string; name: string; slug: string | null; icon_name: string | null; parent_category_id: string | null }

// The About page's "What We Offer" categories (top level + subcategories, with the admin icon) for the mobile app.
export async function GET() {
  const rows = await queryMany<Row>(
    `SELECT id, name, slug, icon_name, parent_category_id
       FROM categories WHERE is_active = true
      ORDER BY display_order ASC NULLS LAST, name ASC`
  ).catch(() => [] as Row[])

  const subsByParent = new Map<string, Array<{ id: string; name: string; slug: string | null }>>()
  for (const r of rows) {
    if (!r.parent_category_id) continue
    const list = subsByParent.get(r.parent_category_id) ?? []
    list.push({ id: r.id, name: r.name, slug: r.slug })
    subsByParent.set(r.parent_category_id, list)
  }
  const categories = rows
    .filter(r => !r.parent_category_id)
    .map(r => ({ id: r.id, name: r.name, slug: r.slug, icon_name: r.icon_name, subcategories: subsByParent.get(r.id) ?? [] }))

  return NextResponse.json({ categories }, { headers: { 'Cache-Control': 'private, no-store' } })
}
