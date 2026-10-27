import { NextResponse, type NextRequest } from 'next/server'
import { buildHomeModel, toHomeModelJson } from '@/lib/catalog/homepage-model'
import { rowPage } from '@/lib/catalog/homepage-sections'

// The storefront home as JSON for the mobile app. `?surface=app` serves the app's own layout
// (Settings → Homepage → App); anything else, including no parameter, is the website's.
// `?page=products|category|brand` serves the sections that go between the products on a listing.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const requested = params.get('surface')
  const surface = requested === 'app' ? 'app' : 'web'
  const page = rowPage({ page: params.get('page') })
  // No parameter at all is an app build from before per-surface layouts (see LEGACY_APP_HIDDEN_TYPES).
  const model = toHomeModelJson(await buildHomeModel({ surface, page, legacyClient: requested === null }))
  return NextResponse.json(model, {
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
  })
}
