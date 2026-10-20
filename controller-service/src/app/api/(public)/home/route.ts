import { NextResponse } from 'next/server'
import { buildHomeModel, toHomeModelJson } from '@/lib/catalog/homepage-model'

// The storefront home as JSON for the mobile app: same sections and data the web page renders.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function GET() {
  const model = toHomeModelJson(await buildHomeModel())
  return NextResponse.json(model, {
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
  })
}
