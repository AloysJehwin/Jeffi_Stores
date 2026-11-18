import type { ReactNode } from 'react'
import Link from 'next/link'
import ProductGrid from '@/components/visitor/ProductGrid'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import { withListingSections, type PagedItem } from '@/components/visitor/listing/listing-sections'
import type { RenderCtx } from '@/lib/site/code/registry'
import { siteCard } from '@/lib/site/card'
import { ProductItem } from '../../common/SiteCard'
import { rowViews } from '../product/views'
import { listingParts } from './context'

// ProductResults and the listing parts' previews. On a listing page ProductResults is the page's own infinite list;
// off one (the onboarding preview) every listing part shows the catalogue's products, inert.

const GRID = 'grid grid-flow-row-dense gap-3 sm:gap-6'
const COLS: Record<number, string> = {
  2: `${GRID} grid-cols-2`,
  3: `${GRID} grid-cols-2 lg:grid-cols-3`,
  4: `${GRID} grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`,
}

const own = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

function gridFor(props: Record<string, unknown>, fallback: string) {
  return own(props.className) ?? COLS[Number(props.columns)] ?? fallback
}

function Empty({ basePath, text }: { basePath: string; text: string }) {
  return (
    <div className="col-span-full bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-12 text-center">
      <h3 className="text-xl font-semibold text-foreground mb-2">No Products Found</h3>
      <p className="text-foreground-secondary mb-6">{text}</p>
      <Link href={basePath} className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
        Clear filters
      </Link>
    </div>
  )
}

export async function renderResults(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const d = listingParts()
  if (!d) return previewResults(ctx, props)
  const grid = gridFor(props, d.grid)
  if (!d.products.length) return <Empty basePath={d.basePath} text={own(props.emptyText) ?? 'Nothing matches these filters. Try adjusting them.'} />
  if (!ctx.renderItem) {
    return (
      <ProductGrid
        products={d.products}
        gstEnabled={d.gstEnabled}
        categoryBanners={d.categoryBanners}
        total={d.total}
        page={d.page}
        pagedItems={d.pagedItems}
        loadPage={d.loadPage}
        basePath={d.basePath}
        gridClassName={grid}
        portal={d.portal}
        controls={props.controls === true}
      />
    )
  }
  // A custom card renders here, on the server; the next pages are plain page links (?page=N), as the default list's
  // loader only knows the default card.
  const render = ctx.renderItem
  const views = await rowViews(d.products, d.gstEnabled, d.productBase)
  let items: PagedItem[] = views.map((v, i) => ({ key: v.id, node: render(v, i) }))
  if (d.sections) items = await withListingSections(items, d.sections)
  return <ServerPagedItems items={items} page={d.page} total={d.total} noun="products" wrap="div" wrapClassName={grid} pageSize={d.pageSize} />
}

async function previewResults(ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  const views = await ctx.data.products({ sort: 'featured', limit: 12 })
  if (!views.length) return null
  const render = ctx.renderItem
  const card = render ? null : await siteCard(ctx.data)
  return (
    <div className={gridFor(props, COLS[3])}>
      {views.map((v, i) => (render ? render(v, i) : <ProductItem key={v.id} product={v} card={card} data={ctx.data} priority={i === 0} />))}
    </div>
  )
}

const CHIP = 'inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-border-default text-foreground-secondary'

/** Off a listing page: what Filters, SortMenu and ResultCount look like. */
export async function renderListingPreview(name: string, ctx: RenderCtx, props: Record<string, unknown>): Promise<ReactNode> {
  if (listingParts()) return null
  const className = own(props.className) ?? undefined
  switch (name) {
    case 'Filters':
      return (
        <div className={className}>
          <span role="presentation" className={CHIP}>
            Filters
          </span>
        </div>
      )
    case 'SortMenu':
      return (
        <div className={className}>
          <span role="presentation" className={CHIP}>
            Sort by: Featured
          </span>
        </div>
      )
    case 'ResultCount': {
      const n = (await ctx.data.products({ sort: 'featured', limit: 24 })).length
      return <p className={className ?? 'text-sm text-foreground-muted'}>{`${n} ${own(props.noun) ?? 'products'}`}</p>
    }
    default:
      return null
  }
}
