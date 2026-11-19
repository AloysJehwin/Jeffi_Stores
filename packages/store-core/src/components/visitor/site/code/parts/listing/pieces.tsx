'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import FilterSidebar from '@/components/visitor/FilterSidebar'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import SortDropdown from '@/components/visitor/SortDropdown'
import { useListingPage } from './ListingPageProvider'

// The listing's client parts for code sections. They read the page's ListingPageProvider; filters and sort change the
// URL, which every part (and ProductResults on the server) follows.

type Cls = { className?: string }

function QuickToggle({ param, label, count, basePath }: { param: string; label: string; count: number; basePath: string }) {
  const sp = useSearchParams()
  const active = sp.get(param) === '1'
  if (!active && count <= 0) return null
  const q = new URLSearchParams(sp.toString())
  if (active) q.delete(param)
  else q.set(param, '1')
  q.delete('page')
  const qs = q.toString()
  return (
    <Link
      href={basePath + (qs ? `?${qs}` : '')}
      scroll={false}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-11 lg:h-9 rounded-lg text-xs font-medium border transition-colors ${active ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
    >
      {label}
      {!active && <span className="text-foreground-muted">({count})</span>}
    </Link>
  )
}

export function FiltersPart({ layout = 'sidebar', className }: Cls & { layout?: 'sidebar' | 'drawer' | 'top' }) {
  const page = useListingPage()
  const f = page?.filters
  if (!page || !f) return null
  const sheet = (always: boolean) => (
    <MobileFilterSheet basePath={page.basePath} categories={f.categories} brands={f.brands} facets={f.facets} offers={f.offers} always={always} />
  )
  if (layout === 'drawer') return <div className={`flex gap-2${className ? ` ${className}` : ''}`}>{sheet(true)}</div>
  if (layout === 'top') {
    return (
      <div className={`flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden${className ? ` ${className}` : ''}`}>
        {sheet(true)}
        <QuickToggle param="inStock" label="In stock" count={Number(f.facets?.inStockCount ?? 0)} basePath={page.basePath} />
        <QuickToggle param="onSale" label="On sale" count={Number(f.facets?.onSaleCount ?? 0)} basePath={page.basePath} />
      </div>
    )
  }
  return (
    <div className={className}>
      <div className="hidden lg:block">
        <FilterSidebar compact basePath={page.basePath} facets={f.facets} categories={f.categories} offers={f.offers} />
      </div>
      <div className="flex gap-2 lg:hidden">{sheet(false)}</div>
    </div>
  )
}

export function SortMenuPart({ className }: Cls) {
  const page = useListingPage()
  if (!page || page.total < 2) return null
  return (
    <div className={className}>
      <SortDropdown basePath={page.basePath} />
    </div>
  )
}

export function ResultCountPart({ noun = 'products', range = false, className }: Cls & { noun?: string; range?: boolean }) {
  const page = useListingPage()
  if (!page) return null
  const text = range && page.total > 0 ? `Showing ${page.start}–${page.end} of ${page.total} ${noun}` : `${page.total} ${noun}`
  return <p className={className ?? 'text-sm text-foreground-muted'}>{text}</p>
}
