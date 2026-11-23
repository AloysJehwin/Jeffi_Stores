import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { parseLandingParams } from '@/lib/shared/attribution'
import { referrerHost } from '@/lib/traffic/channels'
import type { ParsedUa } from '@/lib/traffic/user-agent'
import { classifyLink, CONTACT_TARGETS } from './links'
import type { Geo } from './geo'

// Visit tracking for a Showcase: what the tracker beacons to POST /api/track, kept in showcase_sessions (one row per
// visit) and showcase_events (what it did). Written through the control-plane pool, as showcase_leads is.

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/g
const text = (v: string | undefined, max: number) => {
  const s = (v ?? '').replace(CONTROL_RE, '').trim()
  return s ? s.slice(0, max) : null
}
const int = (lo: number, hi: number) => z.number().transform(n => Math.min(hi, Math.max(lo, Math.round(n))))

export const Beacon = z.object({
  s: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  t: z.enum(['pageview', 'ping', 'click', 'form_start', 'form_submit']),
  p: z.string().max(2000).optional(),
  r: z.string().max(2000).optional(),
  q: z.string().max(2000).optional(),
  h: z.string().max(2000).optional(),
  sc: int(0, 100).optional(),
  en: int(0, 86_400_000).optional(),
  tz: z.string().max(64).optional(),
  lang: z.string().max(35).optional(),
  sw: int(0, 32_000).optional(),
  sh: int(0, 32_000).optional(),
  vw: int(0, 32_000).optional(),
  net: z.string().max(8).optional(),
})
export type BeaconInput = z.infer<typeof Beacon>

/** A visitor's key for one site: stable for their IP and browser, not reversible to either, never the same across sites. */
export function visitorKey(siteId: string, ip: string, ua: string): string {
  return createHmac('sha256', process.env.JWT_SECRET || 'showcase-visitor').update(`${siteId}|${ip}|${ua}`).digest('hex').slice(0, 32)
}

/** Path only, no query or hash. */
const pathOf = (p: string | undefined) => text((p ?? '/').split(/[?#]/)[0] || '/', 500) ?? '/'

/** Origin and path of the referrer; its query (search terms, tokens) is dropped. */
function referrerOf(r: string | undefined): string | null {
  if (!r) return null
  try {
    const u = new URL(r)
    return u.protocol === 'http:' || u.protocol === 'https:' ? text(`${u.origin}${u.pathname}`, 500) : null
  } catch {
    return null
  }
}

const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'] as const

function landing(q: string | undefined, path: string) {
  const a = parseLandingParams(q ?? '', path)
  const params = new URLSearchParams((q ?? '').replace(/^\?/, ''))
  const click = CLICK_IDS.find(k => (k === 'msclkid' ? params.get(k) : a?.[k]))
  return {
    utm_source: a?.utm_source ?? null,
    utm_medium: a?.utm_medium ?? null,
    utm_campaign: a?.utm_campaign ?? null,
    utm_term: a?.utm_term ?? null,
    utm_content: a?.utm_content ?? null,
    click_id: click ?? null,
  }
}

export interface TrackContext {
  siteId: string
  siteHost: string
  visitorKey: string
  ua: ParsedUa
  geo: Geo
}

/** Records one beacon. A page view opens (or extends) the visit; anything else for an unknown visit is dropped. */
export async function recordBeacon(b: BeaconInput, ctx: TrackContext): Promise<void> {
  const pool = controlPlanePool()
  const path = pathOf(b.p)
  if (b.t === 'pageview') {
    const ref = referrerOf(b.r)
    const l = landing(b.q, path)
    await pool.query(
      `WITH s AS (
         INSERT INTO showcase_sessions (site_id, session_id, visitor_key, is_new, landing_path, referrer, ref_host,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id, device, browser, os, country, region, city,
           timezone, language, screen_w, screen_h, viewport_w, net)
         VALUES ($1::uuid, $2::text, $3::text,
           NOT EXISTS (SELECT 1 FROM showcase_sessions p WHERE p.site_id = $1::uuid AND p.visitor_key = $3::text AND p.started_at > now() - interval '90 days'),
           $4::text, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         ON CONFLICT (site_id, session_id) DO UPDATE SET pageviews = showcase_sessions.pageviews + 1, last_seen_at = now()
         RETURNING session_id
       )
       INSERT INTO showcase_events (site_id, session_id, type, path) SELECT $1::uuid, session_id, 'pageview', $4::text FROM s`,
      [
        ctx.siteId,
        b.s,
        ctx.visitorKey,
        path,
        ref,
        ref ? referrerHost(ref)?.slice(0, 253) ?? null : null,
        l.utm_source,
        l.utm_medium,
        l.utm_campaign,
        l.utm_term,
        l.utm_content,
        l.click_id,
        ctx.ua.device,
        ctx.ua.browser.slice(0, 32),
        ctx.ua.os.slice(0, 32),
        ctx.geo.country,
        ctx.geo.region,
        ctx.geo.city,
        text(b.tz, 64),
        text(b.lang, 16),
        b.sw || null,
        b.sh || null,
        b.vw || null,
        text(b.net, 8),
      ]
    )
    return
  }

  const link = b.t === 'click' && b.h ? classifyLink(b.h, ctx.siteHost) : null
  if (b.t === 'click' && !link) return
  const contact = !!link && CONTACT_TARGETS.includes(link.target)
  await pool.query(
    `WITH s AS (
       UPDATE showcase_sessions
          SET last_seen_at = now(),
              max_scroll = GREATEST(max_scroll, $3::int),
              engaged_ms = GREATEST(engaged_ms, $4::int),
              contact_at = CASE WHEN $5::boolean THEN COALESCE(contact_at, now()) ELSE contact_at END,
              form_started_at = CASE WHEN $6::text = 'form_start' THEN COALESCE(form_started_at, now()) ELSE form_started_at END,
              form_submitted_at = CASE WHEN $6::text = 'form_submit' THEN COALESCE(form_submitted_at, now()) ELSE form_submitted_at END
        WHERE site_id = $1::uuid AND session_id = $2::text
        RETURNING session_id
     )
     INSERT INTO showcase_events (site_id, session_id, type, target, label, path)
     SELECT $1::uuid, session_id, $6::text, $7::text, $8::text, $9::text FROM s WHERE $6::text <> 'ping'`,
    [ctx.siteId, b.s, b.sc ?? 0, b.en ?? 0, contact, b.t, link?.target ?? null, link?.label ?? null, path]
  )
}

/**
 * The visit an enquiry came from: this visitor's latest on the site in the last six hours, marked as having sent the
 * form. Null without one (no script, or a visit from another network).
 */
export async function visitForLead(siteId: string, key: string): Promise<string | null> {
  const r = await controlPlanePool().query(
    `UPDATE showcase_sessions SET form_submitted_at = COALESCE(form_submitted_at, now()), last_seen_at = now()
      WHERE id = (SELECT id FROM showcase_sessions WHERE site_id = $1 AND visitor_key = $2 AND last_seen_at > now() - interval '6 hours'
                  ORDER BY last_seen_at DESC LIMIT 1)
      RETURNING session_id`,
    [siteId, key]
  )
  return r.rows[0]?.session_id ?? null
}
