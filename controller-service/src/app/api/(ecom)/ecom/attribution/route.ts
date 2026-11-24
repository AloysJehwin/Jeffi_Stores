import { NextRequest, NextResponse } from 'next/server'
import {
  ATTRIBUTION_COOKIE,
  attributionCookieOptions,
  decodeAttribution,
  encodeAttribution,
  mergeAttribution,
  parseAttribution,
} from '@controller/lib/attribution/capture'

export const dynamic = 'force-dynamic'

// The ecom landing posts the click ids and UTM tags from its URL ({ params, landingPath }); they are kept in a
// first-party cookie (90 days, SameSite=Lax) that signup reads. Nothing in the URL: no click id or UTM, no cookie.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { params?: Record<string, unknown>; landingPath?: unknown } | null
  const next = parseAttribution(body?.params, body?.landingPath)
  if (!next) return NextResponse.json({ captured: false })
  const merged = mergeAttribution(decodeAttribution(request.cookies.get(ATTRIBUTION_COOKIE)?.value), next)
  const res = NextResponse.json({ captured: true })
  res.cookies.set(ATTRIBUTION_COOKIE, encodeAttribution(merged), attributionCookieOptions())
  return res
}
