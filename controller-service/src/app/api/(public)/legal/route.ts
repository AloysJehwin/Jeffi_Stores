import { NextResponse } from 'next/server'
import { policies } from '@/lib/legals/policies'

// The /legal index as JSON for the mobile app (the web page renders the same module server-side).
export function GET() {
  return NextResponse.json(
    {
      policies: policies
        .filter(p => !p.unlisted)
        .map(({ slug, title, description, lastUpdated }) => ({ slug, title, description, lastUpdated })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
