import { NextResponse } from 'next/server'
import { getStorePolicies } from '@/lib/legals/store-policies'

export const dynamic = 'force-dynamic'

// The /legal index as JSON for the mobile app (the web page renders the same module server-side).
export async function GET() {
  const policies = await getStorePolicies()
  return NextResponse.json(
    {
      policies: policies
        .filter(p => !p.unlisted)
        .map(({ slug, title, description, lastUpdated }) => ({ slug, title, description, lastUpdated })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
