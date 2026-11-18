export const dynamic = 'force-dynamic'

import { renderPartsPage } from '@/components/visitor/site/code/parts/product/site-page'
import ListingPageParts from '@/components/visitor/site/code/parts/listing/ListingPageParts'
import { renderProductItem } from '@/components/visitor/listing/listing-items'
import { EAGER_CARDS } from '@/components/visitor/listing/listing-sections'
import { LISTING_PAGE_SIZE, buildListingModel, getListingProducts } from '@/lib/catalog/listing-model'
import { bp } from '@/lib/shared/business-path'
import { getHost } from '@/lib/tenancy/get-host'
import BusinessCatalogClient from './BusinessCatalogClient'

const cards = (rows: any[], gstEnabled: boolean, eager = 0) =>
  rows.map((row, i) => ({ key: String(row.id), node: renderProductItem(row, gstEnabled, i >= eager, 'business') }))

// The business catalogue. With a Site Builder catalog page, it is that page's `catalog_main` block with the store's own
// blocks around it; otherwise it is the page. An AI catalog page lists the catalogue through the listing parts.
export default async function BusinessCatalogPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const sp = await searchParams
  const { site, code } = await renderPartsPage({ audience: 'business', page: 'catalog' }, { preview: sp.preview, layout: sp.layout }, 'catalog_main', <BusinessCatalogClient />, ['ProductResults'])
  if (!site) return <BusinessCatalogClient />
  if (!code) return site

  const host = await getHost()
  const { products, total, page, gstEnabled, categories, brands, facets, filterOffers } = await buildListingModel(sp, { categoryBanners: false })
  async function loadPage(p: number) {
    'use server'
    const next = await getListingProducts({ ...sp, page: String(p) })
    return { rows: cards(next.products as any[], next.gstEnabled), total: next.total }
  }
  return (
    <ListingPageParts
      data={{
        kind: 'catalog',
        basePath: bp('/business/catalog', host),
        portal: 'business',
        productBase: bp('/business/products', host),
        products: products as any[],
        gstEnabled,
        total,
        page,
        pageSize: LISTING_PAGE_SIZE,
        pagedItems: cards(products as any[], gstEnabled, EAGER_CARDS),
        loadPage,
        sections: null,
        filters: { facets, categories: categories as any[], brands: brands as any[], offers: filterOffers },
        grid: 'grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6',
      }}
    >
      {site}
    </ListingPageParts>
  )
}
