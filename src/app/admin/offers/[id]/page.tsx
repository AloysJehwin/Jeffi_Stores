import { notFound } from 'next/navigation'
import { z } from 'zod'
import { queryMany } from '@/lib/db'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { getOfferById } from '@/lib/product-offers'
import type { AssignOption } from '@/components/admin/OffersProductPicker'
import OfferDetailClient from './OfferDetailClient'

export const dynamic = 'force-dynamic'

interface CategoryRow {
  id: string
  name: string
  parent_category_id: string | null
}

// Counts roll up active subcategories so each option matches what a bulk add by that category assigns.
function categoryOptions(rows: CategoryRow[], direct: Map<string, number>): AssignOption[] {
  const ids = new Set(rows.map(r => r.id))
  const children = new Map<string | null, CategoryRow[]>()
  for (const row of rows) {
    const parent = row.parent_category_id && ids.has(row.parent_category_id) ? row.parent_category_id : null
    children.set(parent, [...(children.get(parent) ?? []), row])
  }

  const count = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    return (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, c) => sum + count(c.id, seen), 0)
  }

  const options: AssignOption[] = []
  const walk = (node: CategoryRow, group: string, path: string[]) => {
    const n = count(node.id, new Set())
    if (n > 0) {
      const label = path.length ? path.join(' › ') : `All ${node.name}`
      options.push({ value: node.id, label: `${label} · ${n}`, group, name: node.name, count: n })
    }
    for (const child of children.get(node.id) ?? []) walk(child, group, [...path, child.name])
  }
  for (const root of children.get(null) ?? []) walk(root, root.name, [])
  return options
}

async function loadAssignOptions() {
  const [categories, counts, brands] = await Promise.all([
    queryMany<CategoryRow>(
      `SELECT id, name, parent_category_id FROM categories WHERE is_active = true ORDER BY name`
    ),
    queryMany<{ category_id: string; n: number }>(
      `SELECT category_id, count(*)::int AS n FROM products
        WHERE is_active = true AND category_id IS NOT NULL GROUP BY category_id`
    ),
    queryMany<{ id: string; name: string; n: number }>(
      `SELECT b.id, b.name, count(p.id)::int AS n
         FROM brands b JOIN products p ON p.brand_id = b.id AND p.is_active = true
        WHERE b.is_active = true
        GROUP BY b.id, b.name ORDER BY b.name`
    ),
  ])
  return {
    categories: categoryOptions(categories, new Map(counts.map(c => [c.category_id, c.n]))),
    brands: brands.map(b => ({ value: b.id, label: `${b.name} · ${b.n}`, name: b.name, count: b.n })),
  }
}

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()

  const offer = await getOfferById(id)
  if (!offer) notFound()

  const [host, options] = await Promise.all([getHost(), loadAssignOptions()])
  return (
    <OfferDetailClient
      offer={offer}
      backHref={ap('/admin/offers?tab=offers', host)}
      categoryOptions={options.categories}
      brandOptions={options.brands}
    />
  )
}
