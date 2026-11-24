import { NextRequest, NextResponse } from 'next/server'
import { loadPreview, previewState } from '@showcase/lib/preview'

export const dynamic = 'force-dynamic'

// What the preview page polls (every 3s): the page version, status and expiry, and a hash per section. Read-only;
// nothing of the site's content. 410 once the link has run out, 404 for a bad token or another site's host.

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? req.headers.get('x-forwarded-host') ?? ''
  const p = await loadPreview(req.nextUrl.searchParams.get('t'), host)
  if (p.kind === 'invalid') return NextResponse.json({ ok: false, state: 'invalid' }, { status: 404, headers: HEADERS })
  if (p.kind === 'expired') return NextResponse.json({ ok: false, state: 'expired' }, { status: 410, headers: HEADERS })
  return NextResponse.json({ ok: true, ...previewState(p.site, p.expiresAt) }, { headers: HEADERS })
}
