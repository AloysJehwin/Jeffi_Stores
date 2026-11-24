import { NextRequest, NextResponse } from 'next/server'
import { fail, readJson, studioOwner } from '@controller/lib/site-studio/http'
import { publishOwnerShowcase } from '@controller/lib/showcase-builder/publish'
import { siteForClient } from '@controller/lib/showcase-builder/site'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Puts a Showcase site live (body { siteId }) with its studio's page and look (the first time starts its trial), or
// brings a live site up to date with design changes. → { site, url, first } or { error, code, checkoutUrl? }.
export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const r = await publishOwnerShowcase(owner.id, (await readJson(request))?.siteId)
  if (!r.ok) return fail(r.error, r.status, { ...(r.code ? { code: r.code } : {}), ...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}) })
  return NextResponse.json({ site: siteForClient(r.site), url: r.url, first: r.first })
}
