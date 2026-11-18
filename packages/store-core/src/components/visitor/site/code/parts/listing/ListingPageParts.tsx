import type { ReactNode } from 'react'
import { setListingParts, type ListingPartsData } from './context'
import { ListingPageProvider } from './ListingPageProvider'

/**
 * Mounted by a listing page (products, search, category, brand, business catalogue) around its content: the data
 * ProductResults renders from, and the client provider Filters, SortMenu and ResultCount read.
 */
export default function ListingPageParts({ data, children }: { data: ListingPartsData; children: ReactNode }) {
  setListingParts(data)
  const shown = data.products.length
  const start = shown ? (data.page - 1) * data.pageSize + 1 : 0
  return (
    <ListingPageProvider
      value={{ kind: data.kind, basePath: data.basePath, total: data.total, start, end: shown ? start + shown - 1 : 0, filters: data.filters }}
    >
      {children}
    </ListingPageProvider>
  )
}
