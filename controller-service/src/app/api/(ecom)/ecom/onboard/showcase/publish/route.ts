import { NextRequest, NextResponse } from 'next/server'
import { fail, studioOwner } from '@controller/lib/site-studio/http'
import { publishOwnerShowcase } from '@controller/lib/showcase-builder/publish'
import { siteForClient } from '@controller/lib/showcase-builder/site'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Puts the owner's Showcase live with the studio's page and look (the first time starts its free month), or brings a
// live site up to date with design changes. → { site, url, first } or { error, code }.
export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const r = await publishOwnerShowcase(owner.id)
  if (!r.ok) return fail(r.error, r.status, { ...(r.code ? { code: r.code } : {}), ...(r.topUpUrl ? { topUpUrl: r.topUpUrl } : {}) })
  return NextResponse.json({ site: siteForClient(r.site), url: r.url, first: r.first })
}
