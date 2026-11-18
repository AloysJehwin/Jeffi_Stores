import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import ProductCard from '@/components/visitor/ProductCard'
import { renderProductItem } from '@/components/visitor/listing/listing-items'
import { SiteCardView } from '@/components/visitor/site/code/common/SiteCard'
import { ratingsFor, rowViews } from '@/components/visitor/site/code/parts/product/views'
import { siteCard } from '@/lib/site/card'
import { money, siteData, type ProductView } from '@/lib/site/data'
import { getPageSections, loadSectionData } from '@/lib/catalog/homepage-model'
import type { HomepageDraftState } from '@/lib/catalog/homepage-draft'
import { HALF_CELL, HALF_ROW } from '@/components/visitor/home/HomeSections'
import {
  groupRows,
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
  /** A product drawn with the site card (lib/site/card.ts), which the grid's other views reuse as it is. */
  card?: boolean
}

export interface ListingOpts {
  page: Exclude<HomepagePage, 'home'>
  surface: HomepageSurface
  pageNum: number
  pageSize: number
  total: number
  /** Preview: a draft's rows instead of the live layout. */
  draft?: HomepageDraftState | null
}

export interface ListingPlacement {
  section: HomepageSection
  /** The right half of a two-column row; it follows `section`'s placement and ignores its own. */
  partner?: HomepageSection
  /** Products before it on this page. */
  at: number
  key: string
}

/**
 * The admin's sections for a listing page that land on page `pageNum`: a section after the Pth
 * product (P counted across the whole result) goes on the page holding that product. A two-column
 * row goes where its left section does.
 */
export function placementsOnPage(
  sections: HomepageSection[],
  { pageNum, pageSize, total }: { pageNum: number; pageSize: number; total: number }
): ListingPlacement[] {
  const first = (pageNum - 1) * pageSize
  const out: ListingPlacement[] = []
  groupRows(sections).forEach(([section, partner]) => {
    for (const p of placementPositions(sectionPlacement(section), total)) {
      const onPage = Math.max(1, Math.ceil(p / pageSize))
      if (onPage === pageNum) out.push({ section, partner, at: p - first, key: `section:${section.id}:${p}` })
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

type CardProps = ComponentProps<typeof ProductCard>
const isProductCard = (n: ReactNode): n is ReactElement<CardProps> => isValidElement(n) && n.type === ProductCard

/** A ProductCard's props as the site card's product (no second picture: a listing row's card carries only one). */
function cardView(c: CardProps, rating?: { rating: number; count: number }): ProductView {
  const price = Number(c.displayPrice) || 0
  const mrp = c.mrp && c.mrp > price ? c.mrp : null
  const pct = Number(c.mrpDiscount) || 0
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    url: `/products/${c.slug}`,
    image: c.primaryImage?.image_url ?? null,
    hoverImage: null,
    price: money(price),
    mrp: mrp ? money(mrp) : null,
    discountPct: pct,
    badge: c.badge ?? (pct >= 5 ? `${pct}% off` : null),
    brand: c.brandName ?? null,
    category: c.categoryName ?? null,
    inStock: !!c.isDigital || c.effectiveStock > 0,
    rating: rating?.rating ?? null,
    reviewCount: rating?.count ?? 0,
    hasVariants: !!c.hasVariants,
    brandSlug: null,
    categorySlug: null,
    categoryId: c.categoryId ?? null,
    isDigital: !!c.isDigital,
  }
}

/** Store product cards a listing drew itself (the brand page's) as the site card instead, when the store has one. */
async function withSiteCards(items: PagedItem[]): Promise<PagedItem[]> {
  const drawn = items.filter(i => !i.card && isProductCard(i.node) && i.node.props.portal !== 'business')
  if (!drawn.length) return items
  const card = await siteCard()
  if (!card) return items
  const ratings = await ratingsFor(drawn.map(i => String((i.node as ReactElement<CardProps>).props.id))).catch(() => new Map<string, { rating: number; count: number }>())
  const data = siteData()
  const swap = new Set(drawn)
  return items.map(i => {
    if (!swap.has(i)) return i
    const c = (i.node as ReactElement<CardProps>).props
    return { ...i, card: true, node: <SiteCardView card={card} product={cardView(c, ratings.get(String(c.id)))} data={data} /> }
  })
}

/** This page's products with the listing's admin sections spliced in, each loading only its own data. */
export async function withListingSections(items: PagedItem[], opts: ListingOpts): Promise<PagedItem[]> {
  if (items.length === 0) return items
  items = await withSiteCards(items)
  const sections = await getPageSections({ surface: opts.surface, page: opts.page, draft: opts.draft }).catch(() => [])
  const placed = placementsOnPage(sections, opts)
  if (placed.length === 0) return items
  const used = [...new Map(placed.flatMap(p => [p.section, ...(p.partner ? [p.partner] : [])]).map(s => [s.id, s])).values()]
  const data = await loadSectionData(used, { surface: opts.surface, page: opts.page, draft: opts.draft })
  let rows = 0
  const render = (section: HomepageSection) => (
    <SectionRenderer section={section} data={data} rowIndex={section.type === 'product_row' ? rows++ : 0} />
  )
  return spliceAt(
    items,
    placed.map(p => ({
      at: p.at,
      item: {
        key: p.key,
        extra: true,
        node: p.partner ? (
          <div className={`${WRAP} ${HALF_ROW}`}>
            <div className={HALF_CELL}>{render(p.section)}</div>
            <div className={HALF_CELL}>{render(p.partner)}</div>
          </div>
        ) : (
          <div className={WRAP}>{render(p.section)}</div>
        ),
      },
    }))
  )
}

/** One page of a listing: its product cards with the sections that land on that page. The first
 *  `eager` cards (the first screen of the server page) load their images and prefetch as usual.
 *  With a site card every product is drawn with it (the next pages too: loadPage comes here). */
export async function productPageItems(products: any[], gstEnabled: boolean, listing: ListingOpts, eager = 0): Promise<PagedItem[]> {
  const card = products.length ? await siteCard() : null
  if (!card)
    return withListingSections(
      products.map((product, i) => ({ key: String(product.id), node: renderProductItem(product, gstEnabled, i >= eager) })),
      listing
    )
  const data = siteData()
  const views = await rowViews(products, gstEnabled)
  return withListingSections(
    views.map((v, i) => ({ key: String(products[i].id), card: true, node: <SiteCardView card={card} product={v} data={data} priority={eager > 0 && i === 0} /> })),
    listing
  )
}

/** Cards on the first screen of a listing; the rest are deferred. */
export const EAGER_CARDS = 6

/** ServerPagedItems with the listing's sections spliced between the products. */
export async function ListingPagedItems({
  items,
  listing,
  ...props
}: Omit<ComponentProps<typeof ServerPagedItems>, 'items'> & { items: PagedItem[]; listing: ListingOpts }) {
  return <ServerPagedItems {...props} items={await withListingSections(items, listing)} />
}
