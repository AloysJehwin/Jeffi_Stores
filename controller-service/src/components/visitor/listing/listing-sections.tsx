import type { ComponentProps, ReactNode } from 'react'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import { getPageSections, loadSectionData } from '@/lib/catalog/homepage-model'
import {
  placementPositions,
  sectionPlacement,
  type HomepagePage,
  type HomepageSection,
  type HomepageSurface,
} from '@/lib/catalog/homepage-sections'

export interface PagedItem {
  key: string
  node: ReactNode
  /** Not a product: left out of the paged count. */
  extra?: boolean
}

export interface ListingOpts {
  page: Exclude<HomepagePage, 'home'>
  surface: HomepageSurface
  pageNum: number
  pageSize: number
  total: number
}

export interface ListingPlacement {
  section: HomepageSection
  /** Products before it on this page. */
  at: number
  key: string
}

/**
 * The admin's sections for a listing page that land on page `pageNum`: a section after the Pth
 * product (P counted across the whole result) goes on the page holding that product.
 */
export function placementsOnPage(
  sections: HomepageSection[],
  { pageNum, pageSize, total }: { pageNum: number; pageSize: number; total: number }
): ListingPlacement[] {
  const first = (pageNum - 1) * pageSize
  const out: ListingPlacement[] = []
  sections.forEach(section => {
    for (const p of placementPositions(sectionPlacement(section), total)) {
      const onPage = Math.max(1, Math.ceil(p / pageSize))
      if (onPage === pageNum) out.push({ section, at: p - first, key: `section:${section.id}:${p}` })
    }
  })
  return out.sort((a, b) => a.at - b.at)
}

/** Inserts nodes after the given number of non-extra items; `at` past the end appends. */
export function spliceAt(items: PagedItem[], inserts: { at: number; item: PagedItem }[]): PagedItem[] {
  if (inserts.length === 0) return items
  const out: PagedItem[] = []
  let products = 0
  let next = 0
  for (const item of items) {
    while (next < inserts.length && inserts[next].at <= products && !item.extra) out.push(inserts[next++].item)
    out.push(item)
    if (!item.extra) products++
  }
  while (next < inserts.length) out.push(inserts[next++].item)
  return out
}

// Home sections bring their own container and generous padding; inside the product grid they
// span the row, drop the container and keep a tighter rhythm. A section with nothing to show
// renders null, and the empty cell is hidden so it adds no gap.
const WRAP =
  'col-span-full min-w-0 overflow-hidden rounded-2xl empty:hidden [&_.container]:max-w-none [&_.container]:px-0 [&>section]:py-6 md:[&>section]:py-8'

/** This page's products with the listing's admin sections spliced in, each loading only its own data. */
export async function withListingSections(items: PagedItem[], opts: ListingOpts): Promise<PagedItem[]> {
  if (items.length === 0) return items
  const sections = await getPageSections({ surface: opts.surface, page: opts.page }).catch(() => [])
  const placed = placementsOnPage(sections, opts)
  if (placed.length === 0) return items
  const used = [...new Map(placed.map(p => [p.section.id, p.section])).values()]
  const data = await loadSectionData(used, { surface: opts.surface, page: opts.page })
  let rows = 0
  return spliceAt(
    items,
    placed.map(p => ({
      at: p.at,
      item: {
        key: p.key,
        extra: true,
        node: (
          <div className={WRAP}>
            <SectionRenderer
              section={p.section}
              data={data}
              rowIndex={p.section.type === 'product_row' ? rows++ : 0}
            />
          </div>
        ),
      },
    }))
  )
}

/** ServerPagedItems with the listing's sections spliced between the products. */
export async function ListingPagedItems({
  items,
  listing,
  ...props
}: Omit<ComponentProps<typeof ServerPagedItems>, 'items'> & { items: PagedItem[]; listing: ListingOpts }) {
  return <ServerPagedItems {...props} items={await withListingSections(items, listing)} />
}
