import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { queryMany } from '@/lib/shared/db'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getOfferById } from '@/lib/catalog/product-offers'
import type { AssignOption } from '@/components/admin/OffersProductPicker'
import OfferDetailClient from '../OfferDetailClient'
import { initialDraftLock } from '@/lib/admin/draft-locks'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { draftBehind, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'
import { offerDrafts, offerFieldsOf } from '@/lib/admin/offer-drafts'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'

export const dynamic = 'force-dynamic'

interface CategoryRow {
  id: string
  name: string
  parent_category_id: string | null
}

// Mirror of /view/page.tsx: counts roll up active subcategories.
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
    queryMany<CategoryRow>(`SELECT id, name, parent_category_id FROM categories WHERE is_active = true ORDER BY name`),
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

// Editing ALWAYS goes through a draft (?draft=<id>). Without one, open the admin's own draft;
// otherwise /view lists the open drafts and its Edit button starts one. The live offer is never
// edited directly through this route.
export default async function EditOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const { draft } = await searchParams
  if (!z.guid().safeParse(id).success) notFound()

  const offer = await getOfferById(id)
  if (!offer) notFound()

  const host = await getHost()
  let draftRow = draft && z.guid().safeParse(draft).success ? await getDraftRow(offerDrafts, draft) : null
  if (draftRow && draftRow.offer_id !== id) draftRow = null
  if (!draftRow) {
    const session = await getAdminSession()
    const mine = session ? (await draftsOf(offerDrafts, id)).find(d => d.authorId === session.adminId) : null
    redirect(ap(mine ? `/admin/offers/${id}/edit?draft=${mine.id}` : `/admin/offers/${id}/view`, host))
  }

  const draftId = draftRow.id as string
  const [options, initialLock, behind, siblings] = await Promise.all([
    loadAssignOptions(),
    initialDraftLock('offer', draftId),
    draftBehind(offerDrafts, draftId),
    draftsOf(offerDrafts, id).then(d => d.length - 1),
  ])
  return (
    <OfferDetailClient
      offer={{ ...offer, ...offerFieldsOf(draftRow.fields ?? {}) }}
      draftId={draftId}
      draftTitle={draftRow.title ?? null}
      backHref={ap('/admin/offers?tab=offers', host)}
      categoryOptions={options.categories}
      brandOptions={options.brands}
      initialLock={initialLock}
      notices={<DraftBehindBanner info={behind} siblings={siblings} noun="offer" />}
    />
  )
}
