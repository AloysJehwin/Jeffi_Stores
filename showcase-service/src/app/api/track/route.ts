import { NextRequest, NextResponse } from 'next/server'
import { parseUserAgent } from '@/lib/traffic/user-agent'
import { siteForHost } from '@showcase/lib/site'
import { hit } from '@showcase/lib/rate-limit'
import { visitorGeo } from '@showcase/lib/geo'
import { Beacon, recordBeacon, visitorKey } from '@showcase/lib/track'

export const dynamic = 'force-dynamic'

// The tracker's beacon (app/Tracker.tsx): one JSON event per call, sent with sendBeacon. Only the site's own pages,
// only live sites, no bots or prefetches, and per-visitor limits like the contact form's. Always answers without a
// body: the tracker never reads it.

const MAX_BODY = 4 * 1024
const PER_SITE = { max: 240, windowSecs: 10 * 60 }
const PER_DAY = { max: 3000, windowSecs: 24 * 60 * 60 }

const done = (status = 204) => new NextResponse(null, { status })

/** The body as text, or null past MAX_BODY (a chunked body has no content-length to refuse up front). */
async function readCapped(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength
    if (size > MAX_BODY) {
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(r.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return done(413)
  const origin = req.headers.get('origin')
  if (origin && origin !== 'null') {
    let from = ''
    try {
      from = new URL(origin).host
    } catch {}
    if (from !== host) return done(403)
  }
  const purpose = `${req.headers.get('sec-purpose') ?? ''} ${req.headers.get('purpose') ?? ''}`
  if (/prefetch|prerender/i.test(purpose)) return done()
  const ua = req.headers.get('user-agent') ?? ''
  const parsed = parseUserAgent(ua)
  if (!ua || parsed.device === 'Bot') return done()

  let body: unknown
  try {
    const raw = await readCapped(req)
    if (raw == null) return done(413)
    body = JSON.parse(raw)
  } catch {
    return done(400)
  }
  const b = Beacon.safeParse(body)
  if (!b.success) return done(400)

  const site = await siteForHost(host).catch(() => null)
  if (!site || site.status !== 'live' || site.workspaceSuspended) return done(404)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const [perSite, perDay] = await Promise.all([hit(`showcase:track:${site.id}:${ip}`, PER_SITE.windowSecs), hit(`showcase:track:${ip}`, PER_DAY.windowSecs)])
  if (perSite > PER_SITE.max || perDay > PER_DAY.max) return done(429)

  try {
    await recordBeacon(b.data, {
      siteId: site.id,
      siteHost: host,
      visitorKey: visitorKey(site.id, ip, ua),
      ua: parsed,
      geo: visitorGeo(req.headers, b.data.tz, b.data.lang),
    })
  } catch (e: any) {
    console.error('[showcase-track]', e?.message || e)
  }
  return done()
}
