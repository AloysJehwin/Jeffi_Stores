import { NextResponse } from 'next/server'
import { getPolicyBySlug } from '@/lib/legals/policies'

// One policy as JSON for the mobile app's /legal/[slug] screen.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const policy = getPolicyBySlug(slug)
  if (!policy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ policy }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
