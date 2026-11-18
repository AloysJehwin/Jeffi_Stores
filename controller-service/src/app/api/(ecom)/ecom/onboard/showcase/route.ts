import { NextRequest, NextResponse } from 'next/server'
import { fail, readJson, studioOwner } from '@controller/lib/site-studio/http'
import { ownerShowcase, saveShowcaseDetails, siteForClient } from '@controller/lib/showcase-builder/site'

export const dynamic = 'force-dynamic'

// The owner's Showcase as the builder edits it (the signup's Details step, the dashboard editor's forms).
// GET: the site. POST { slug?, business?, content? }: saves; the first save with a name and a free address creates the
// draft. Answers { site } or 400 { error, field } (field: 'slug' | 'name').
export async function GET(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  return NextResponse.json({ site: siteForClient(await ownerShowcase(owner.id)) })
}

export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const body = await readJson(request)
  if (!body) return fail('Invalid JSON')
  const r = await saveShowcaseDetails(owner.id, body)
  if (!r.ok) return fail(r.error, 400, r.field ? { field: r.field } : undefined)
  return NextResponse.json({ site: siteForClient(r.site) })
}
