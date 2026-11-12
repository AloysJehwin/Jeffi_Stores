import type { ReactNode } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'

// Loading screens for the product listings: the real headings and labels, shimmer where data goes.
// Server-safe so loading.tsx and client components can both render them.

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default'
const CHIP = 'shrink-0 flex items-center gap-1.5 px-3 h-11 lg:h-9 rounded-lg text-xs font-medium border border-border-default text-foreground-secondary'

export const LISTING_GRID = 'grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6'
export const LISTING_GRID_WIDE = 'grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'

export function ProductCardSkeleton() {
  return (
    <div className="bg-surface-elevated rounded-[20px] sm:rounded-lg shadow sm:shadow-sm border border-transparent dark:border-border-default sm:border-border-default overflow-hidden h-full flex flex-col">
      <div className="aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
        <Sk className="h-full w-full" />
      </div>
      <div className="p-2.5 sm:p-5 flex flex-col flex-grow">
        <div className="mb-1.5 sm:mb-2 min-h-[2.5rem] sm:min-h-[3rem] space-y-1.5">
          <Sk className="h-4 w-11/12" />
          <Sk className="h-4 w-3/5" />
        </div>
        <div className="mb-2 sm:mb-3 space-y-1">
          <Sk className="h-3 w-1/2" />
          <Sk className="h-3 w-2/5" />
        </div>
        <div className="mt-auto">
          <Sk className="h-5 sm:h-6 w-24 mb-1" />
          <p className="text-[11px] sm:text-[10px] text-foreground-muted mb-2 sm:mb-3">Inclusive of all taxes</p>
          <div className="flex items-center justify-between gap-1 mt-1 sm:mt-0">
            <Sk className="h-3 w-14" />
            <span className="text-accent-500 font-semibold text-xs sm:text-sm whitespace-nowrap">View Details &#x2192;</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface GridInsert {
  /** Cards before it. */
  at: number
  node: ReactNode
}

/** `inserts` go between the cards (the listing's admin sections, from sections.tsx listingInserts). */
export function ProductGridSkeleton({
  count = 6,
  className = LISTING_GRID,
  inserts = [],
}: {
  count?: number
  className?: string
  inserts?: GridInsert[]
}) {
  const cells: ReactNode[] = []
  let next = 0
  for (let i = 0; i < count; i++) {
    while (next < inserts.length && inserts[next].at <= i) cells.push(<div key={`s${next}`} className="contents">{inserts[next++].node}</div>)
    cells.push(<ProductCardSkeleton key={i} />)
  }
  return <div className={className}>{cells}</div>
}

const funnel = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
  </svg>
)

const sortIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h13M3 12h9m-9 5h5m9-9v12m0 0l-3-3m3 3l3-3" />
  </svg>
)

/** The "Sort by:" control with its value shimmering. */
export function SortDropdownSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-foreground-secondary whitespace-nowrap">Sort by:</span>
      <div className="px-3 py-1.5 h-9 bg-surface-elevated border border-border-default rounded-lg flex items-center w-44">
        <Sk className="h-3.5 w-24" />
      </div>
    </div>
  )
}

/** ProductGrid's control bar: Filters and Sort (phones), Group, view toggle, and the desktop sort. */
export function ListingToolbarSkeleton() {
  return (
    <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 -mx-4 px-4 py-2 mb-4 bg-surface border-b border-border-default flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:static lg:mx-0 lg:px-0 lg:py-0 lg:mb-6 lg:bg-transparent lg:border-0 lg:overflow-visible lg:flex-wrap">
      <span className={`lg:hidden ${CHIP}`}>
        {funnel}
        Filters
      </span>
      <span className={`lg:hidden ${CHIP}`}>
        {sortIcon}
        Sort
      </span>
      <span className={CHIP}>
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
        <span className="sm:hidden">Group</span>
        <span className="hidden sm:inline">Group by Category</span>
      </span>
      <span className="shrink-0 flex items-center h-11 lg:h-9 w-[5.5rem] lg:w-[4.5rem] border border-border-default rounded-lg overflow-hidden">
        <span className="flex-1 h-full bg-accent-50 dark:bg-accent-900/20" />
        <span className="flex-1 h-full border-l border-border-default" />
      </span>
      <div className="hidden lg:flex ml-auto">
        <SortDropdownSkeleton />
      </div>
    </div>
  )
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border-default pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-foreground text-sm">{title}</span>
      </div>
      {children}
    </div>
  )
}

function CheckRow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="shrink-0 w-4 h-4 rounded border border-border-strong" />
      {label ? <span className="flex-1 text-sm text-foreground-secondary">{label}</span> : <Sk className="h-3.5 flex-1" />}
    </div>
  )
}

/** The desktop FilterSidebar: real section titles, shimmering options. */
export function FilterSidebarSkeleton({ categories = true }: { categories?: boolean }) {
  return (
    <div className={`${CARD} p-4 sm:p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg text-foreground">Filters</h2>
      </div>
      {categories && (
        <FilterSection title="Categories">
          <div className="space-y-2">
            {['w-1/3', 'w-3/4', 'w-1/2', 'w-2/3', 'w-3/5'].map((w, i) => (
              <Sk key={i} className={`h-4 ${w}`} />
            ))}
          </div>
        </FilterSection>
      )}
      <FilterSection title="Price Range">
        <Sk className="h-4 w-32 mb-3" />
        <div className="flex items-center gap-2 mb-3">
          <Sk className="h-8 flex-1 rounded-lg" />
          <span className="text-foreground-muted text-sm">–</span>
          <Sk className="h-8 flex-1 rounded-lg" />
          <span className="shrink-0 px-3 py-1.5 text-sm font-medium bg-accent-500 text-white rounded-lg">Go</span>
        </div>
      </FilterSection>
      <FilterSection title="Availability">
        <CheckRow label="In Stock" />
        <CheckRow label="Include Out of Stock" />
      </FilterSection>
      <FilterSection title="Offers">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-border-default text-foreground-secondary">
          On Sale
        </span>
      </FilterSection>
      <FilterSection title="Brand">
        <CheckRow />
        <CheckRow />
        <CheckRow />
      </FilterSection>
    </div>
  )
}

/** /products: sidebar (with the search box on the business portal), heading, toolbar, card grid. */
export function ProductsListingSkeleton({
  subtitle,
  search = false,
  grid,
}: {
  subtitle?: string
  search?: boolean
  /** The card grid with the listing's sections spliced in (sections.tsx listingInserts). */
  grid?: { count: number; inserts: GridInsert[] }
}) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading products">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          <aside className="hidden lg:block lg:col-span-1 py-6">
            {search && (
              <div className={`${CARD} p-4 mb-4`}>
                <div className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground-muted">
                  Search products...
                </div>
                <div className="mt-2 w-full bg-accent-500 text-white px-4 py-2 rounded-lg font-medium text-center">Search</div>
              </div>
            )}
            <FilterSidebarSkeleton />
          </aside>
          <div className="lg:col-span-3 py-6">
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
              {subtitle && <p className="text-foreground-secondary text-sm mt-1">{subtitle}</p>}
            </div>
            <ListingToolbarSkeleton />
            <ProductGridSkeleton {...grid} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** /categories and /brands: header band and the card grid. */
export function TaxonomyIndexSkeleton({ title, subtitle, kind }: { title: string; subtitle: string; kind: 'category' | 'brand' }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">{title}</h1>
          <p className="text-foreground-secondary">{subtitle}</p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${CARD} overflow-hidden p-4 sm:p-6`}>
              <div className="flex items-center gap-4 mb-4">
                {kind === 'category' ? (
                  <span aria-hidden className="sk block w-16 h-16 rounded-lg flex-shrink-0 bg-accent-100 dark:bg-accent-900/30" />
                ) : (
                  <Sk className="w-16 h-16 rounded-lg flex-shrink-0" />
                )}
                <div className="flex-1 space-y-2">
                  <Sk className="h-6 w-2/3" />
                  <Sk className="h-4 w-20" />
                </div>
              </div>
              <Sk className="h-4 w-11/12 mb-4" />
              {kind === 'category' && (
                <div className="border-t border-border-default pt-4">
                  <p className="text-xs font-medium text-foreground-muted mb-2">Subcategories:</p>
                  <div className="flex flex-wrap gap-2">
                    {['w-16', 'w-20', 'w-14'].map(w => (
                      <Sk key={w} className={`h-6 ${w}`} />
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 flex items-center text-accent-500 font-semibold text-sm">
                Browse Products
                <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "Home / {section} / {name}" with the current name shimmering. */
export function BreadcrumbSkeleton({ trail }: { trail: string[] }) {
  return (
    <nav className="flex items-center gap-2 text-sm mb-4" aria-hidden>
      {trail.map(t => (
        <span key={t} className="contents">
          <span className="text-foreground-muted">{t}</span>
          <span className="text-foreground-muted">/</span>
        </span>
      ))}
      <Sk className="h-4 w-28" />
    </nav>
  )
}

/**
 * /categories/[slug] and /brands/[slug]. The storefront category page keeps ProductGrid's toolbar;
 * the brand page and the business category page put the sort beside "Products".
 */
export function TaxonomyDetailSkeleton({
  kind,
  toolbar = false,
  gridClassName = LISTING_GRID_WIDE,
  grid,
}: {
  kind: 'category' | 'brand'
  toolbar?: boolean
  gridClassName?: string
  /** The card grid with the listing's sections spliced in (sections.tsx listingInserts). */
  grid?: { count: number; inserts: GridInsert[] }
}) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading products">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <BreadcrumbSkeleton trail={['Home', kind === 'category' ? 'Categories' : 'Brands']} />
          <div className="flex items-center gap-4">
            {kind === 'brand' && <Sk className="w-16 h-16 rounded-lg flex-shrink-0" />}
            <div className="flex-1">
              <Sk className="h-9 md:h-10 w-56 max-w-full mb-2" />
              <Sk className="h-4 w-80 max-w-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        {kind === 'category' && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4">Subcategories</h2>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface-elevated rounded-xl shadow-sm border border-border-default p-2 sm:p-3 flex flex-col items-center gap-1.5">
                  <span aria-hidden className="sk block w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-accent-100 dark:bg-accent-900/30" />
                  <div className="min-h-[2rem] flex items-center w-full">
                    <Sk className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="flex items-center gap-1 text-xl font-bold text-foreground">
            Products (<Sk className="inline-block h-5 w-8" />)
          </h2>
          {!toolbar && <SortDropdownSkeleton />}
        </div>
        {toolbar && <ListingToolbarSkeleton />}
        <ProductGridSkeleton count={8} {...grid} className={gridClassName} />
      </div>
    </div>
  )
}
