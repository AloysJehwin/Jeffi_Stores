'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ListingFilters, ListingKind } from './context'

/** What the listing's client parts (Filters, SortMenu, ResultCount) share; filters and sort themselves live in the URL. */
export interface ListingPageState {
  kind: ListingKind
  basePath: string
  total: number
  /** 1-based positions of this page's first and last product. */
  start: number
  end: number
  filters: ListingFilters | null
}

const ListingPageContext = createContext<ListingPageState | null>(null)

export function ListingPageProvider({ value, children }: { value: ListingPageState; children: ReactNode }) {
  return <ListingPageContext.Provider value={value}>{children}</ListingPageContext.Provider>
}

/** The mounted listing page, or null outside one. */
export function useListingPage(): ListingPageState | null {
  return useContext(ListingPageContext)
}
