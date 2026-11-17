import * as React from 'react'
import type { LoadPage, PagedNode } from '@/components/admin/kit/infinite'
import type { ListingOpts, PagedItem } from '@/components/visitor/listing/listing-sections'
import type { BrandPageView, CategoryPageView, SearchView } from '@/lib/site/data/types'

export type ListingKind = 'products' | 'search' | 'category' | 'brand' | 'catalog'

/** A listing page's filter data (FilterSidebar / MobileFilterSheet props); null where the page has no filters. */
export interface ListingFilters {
  facets: any
  categories: any[]
  brands: any[]
  offers: { slug: string; title: string }[]
}

/** What the listing page's server-rendered parts read (ProductResults above all). */
export interface ListingPartsData {
  kind: ListingKind
  /** Where sort and filter changes navigate. */
  basePath: string
  portal: 'storefront' | 'business'
  /** Where product links go (`/products`, or the business portal's). */
  productBase: string
  /** This page's product rows. */
  products: any[]
  gstEnabled: boolean
  total: number
  page: number
  pageSize: number
  /** This page's default cards with the listing's sections spliced in. */
  pagedItems: PagedItem[]
  /** The next pages of default cards (a server action). */
  loadPage?: LoadPage<PagedNode>
  /** The listing's between-products sections, for pages of custom cards. */
  sections: ListingOpts | null
  categoryBanners?: any[]
  filters: ListingFilters | null
  /** Built-in grid classes. */
  grid: string
  /** The page's own category, brand or search (Category, Brand, SearchQuery and the parts around them). */
  category?: CategoryPageView | null
  brand?: BrandPageView | null
  search?: SearchView | null
}

type Box = { current: ListingPartsData | null }
// React's per-request cache (the App Router's React); a plain module box where it is missing (unit tests).
const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const fallback: Box = { current: null }
const slot: () => Box = typeof reactCache === 'function' ? reactCache((): Box => ({ current: null })) : () => fallback

export function setListingParts(data: ListingPartsData) {
  slot().current = data
}

/** The current listing page's data, or null outside one. */
export function listingParts(): ListingPartsData | null {
  return slot().current
}
