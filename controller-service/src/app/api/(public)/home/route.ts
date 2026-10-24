import { NextResponse, type NextRequest } from 'next/server'
import { buildHomeModel, toHomeModelJson } from '@/lib/catalog/homepage-model'

// The storefront home as JSON for the mobile app. `?surface=app` serves the app's own layout
// (Settings → Homepage → Mobile app); anything else, including no parameter, is the website's.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('surface')
  const surface = requested === 'app' ? 'app' : 'web'
  // No parameter at all is an app build from before per-surface layouts (see LEGACY_APP_HIDDEN_TYPES).
  const model = toHomeModelJson(await buildHomeModel({ surface, legacyClient: requested === null }))
  return NextResponse.json(model, {
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
  })
}
