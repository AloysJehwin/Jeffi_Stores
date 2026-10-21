import { NextRequest, NextResponse } from 'next/server'
import { buildListingModel, toListingModelJson, type ListingSearchParams } from '@/lib/catalog/listing-model'

// The storefront /products listing as JSON for the mobile app: the same query params, filters, sort,
// paging, facets and offers the web page uses. Products leave as card props only. `slim=1` returns just
// the page of products (the app's later infinite-scroll pages, which already have the facets).
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  const params: ListingSearchParams = {}
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'slim' && params[key] === undefined) params[key] = value
  })
  try {
    const model = toListingModelJson(await buildListingModel(params))
    const body =
      request.nextUrl.searchParams.get('slim') === '1'
        ? {
            products: model.products,
            total: model.total,
            page: model.page,
            pageSize: model.pageSize,
            totalPages: model.totalPages,
            start: model.start,
            end: model.end,
            gstEnabled: model.gstEnabled,
          }
        : model
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }
}
