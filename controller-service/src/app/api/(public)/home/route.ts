import { NextResponse, type NextRequest } from 'next/server'
import { buildHomeModel, toHomeModelJson } from '@/lib/catalog/homepage-model'

// The storefront home as JSON for the mobile app. `?surface=app` serves the app's own layout
// (Settings → Homepage → Mobile app); anything else, including no parameter, is the website's.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET(req: NextRequest) {
  const surface = req.nextUrl.searchParams.get('surface') === 'app' ? 'app' : 'web'
  const model = toHomeModelJson(await buildHomeModel({ surface }))
  return NextResponse.json(model, {
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
  })
}
