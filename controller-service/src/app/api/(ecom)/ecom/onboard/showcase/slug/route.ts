import { NextRequest, NextResponse } from 'next/server'
import { studioOwner } from '@controller/lib/site-studio/http'
import { ownedShowcase } from '@controller/lib/showcase-builder/site'
import { checkShowcaseSlug } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'

export const dynamic = 'force-dynamic'

// GET ?slug=&site= → whether site-{slug} can be that site's address: { ok, slug, host } or { ok: false, error }. The
// site's own address is always its own; without a site (a new one) every taken address is refused.
export async function GET(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const raw = (request.nextUrl.searchParams.get('slug') ?? '').toLowerCase().trim()
  const own = await ownedShowcase(owner.id, request.nextUrl.searchParams.get('site'))
  if (own && own.slug === raw) return NextResponse.json({ ok: true, slug: raw, host: showcaseHost(raw) })
  const r = await checkShowcaseSlug(raw)
  return NextResponse.json(r.ok ? { ok: true, slug: r.slug, host: showcaseHost(r.slug) } : r)
}
