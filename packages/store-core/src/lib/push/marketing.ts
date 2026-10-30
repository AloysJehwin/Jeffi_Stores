import { queryOne, withTransaction } from '@/lib/shared/db'
import type { NotificationCategory } from '@/lib/push/preferences'

// Guardrails shared by every marketing push (Mailer broadcasts and scenarios): quiet hours in the
// device's time zone, a per-person daily cap, the Site Controls gate, and the inbox row.

const DEFAULT_TZ = 'Asia/Kolkata'

// "HH:MM-HH:MM" in the device's local time; sends inside it wait until it ends. PUSH_QUIET_HOURS overrides.
function parseWindow(v: string | undefined): { start: number; end: number } | null {
  const m = (v ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const start = +m[1] * 60 + +m[2]
  const end = +m[3] * 60 + +m[4]
  return start < 1440 && end <= 1440 && start !== end ? { start, end } : null
}
export const QUIET_HOURS = parseWindow(process.env.PUSH_QUIET_HOURS) ?? { start: 0, end: 9 * 60 }
/** Marketing pushes per person (or signed-out install) in a rolling 24 hours. PUSH_DAILY_CAP overrides. */
export const DAILY_CAP = Math.max(1, Math.trunc(Number(process.env.PUSH_DAILY_CAP)) || 2)

function minuteOfDay(tz: string, at: Date): number {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(tz || DEFAULT_TZ)
  } catch {
    parts = fmt(DEFAULT_TZ)
  }
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return n('hour') * 60 + n('minute')
}

/** When quiet hours end for a device in `tz`, or null if it is outside them right now. */
export function quietUntil(tz: string | null | undefined, at = new Date()): Date | null {
  const { start, end } = QUIET_HOURS
  const m = minuteOfDay(tz || DEFAULT_TZ, at)
  const inside = start < end ? m >= start && m < end : m >= start || m < end
  if (!inside) return null
  const wait = (end - m + 1440) % 1440 || 1440
  const t = new Date(at.getTime() + wait * 60_000)
  t.setUTCSeconds(0, 0)
  return t
}

/** Site Controls: both the push and the marketing-push toggles must be on. */
export async function marketingPushOn(): Promise<boolean> {
  try {
    const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
    const f = await getFeatureFlags()
    return f.pushEnabled && f.marketingPushEnabled
  } catch {
    return false
  }
}

export type PushTarget = { userId: string; deviceId?: string } | { userId: null; deviceId: string }

/**
 * Take one of the person's daily marketing slots for `eventRef` (a campaign id, or a scenario's inbox
 * row). The same event never takes a second slot, so a person's other devices and a quiet-hours
 * device sent later ride on the first. False when the cap is reached.
 */
export async function claimPushSlot(target: PushTarget, source: 'campaign' | 'scenario', eventRef: string): Promise<boolean> {
  const id = target.userId ?? target.deviceId!
  const who = target.userId ? 'user_id = $1' : 'user_id IS NULL AND push_device_id = $1'
  return withTransaction(async c => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`push-cap:${id}`])
    const same = await c.query(`SELECT 1 FROM push_sends WHERE ${who} AND event_ref = $2 LIMIT 1`, [id, eventRef])
    if (same.rowCount) return true
    const n = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM push_sends WHERE ${who} AND sent_at > now() - interval '24 hours'`,
      [id]
    )
    if ((n.rows[0]?.n ?? 0) >= DAILY_CAP) return false
    await c.query(`INSERT INTO push_sends (user_id, push_device_id, source, event_ref) VALUES ($1, $2, $3, $4)`, [
      target.userId,
      target.userId ? (target.deviceId ?? null) : target.deviceId,
      source,
      eventRef.slice(0, 120),
    ])
    return true
  })
}

export interface InboxNotice {
  category: NotificationCategory
  type: string
  title: string
  body: string
  link: string
  image?: string | null
  source: 'campaign' | 'scenario'
  sourceRef: string
}

/** The inbox row for a marketing push. `reuse` returns the user's existing row for the same source (a broadcast). */
export async function writeInbox(userId: string, n: InboxNotice, reuse = false): Promise<string | null> {
  if (reuse) {
    const hit = await queryOne<{ id: string }>(
      `SELECT id FROM notifications WHERE user_id = $1 AND source = $2 AND source_ref = $3 ORDER BY created_at DESC LIMIT 1`,
      [userId, n.source, n.sourceRef.slice(0, 120)]
    )
    if (hit) return hit.id
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO notifications (user_id, type, title, message, link, category, image_url, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      n.type.slice(0, 50),
      n.title.slice(0, 255),
      n.body,
      n.link.slice(0, 500),
      n.category,
      n.image?.slice(0, 500) || null,
      n.source,
      n.sourceRef.slice(0, 120),
    ]
  )
  return row?.id ?? null
}

/** FCM only takes absolute https images. */
export const pushImage = (url: string | null | undefined) => (url && /^https:\/\//i.test(url.trim()) ? url.trim() : undefined)

/** A storefront path for the app (same-store absolute URLs are reduced to their path). */
export function storefrontPath(link: string | null | undefined, storeBase?: string | null): string {
  const raw = (link ?? '').trim()
  if (!raw) return '/'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw.slice(0, 500)
  try {
    const u = new URL(raw)
    const base = storeBase ? new URL(storeBase) : null
    if (base && u.host === base.host) return `${u.pathname}${u.search}`.slice(0, 500) || '/'
    if (/(^|\.)jeffistores\.in$/i.test(u.hostname)) return `${u.pathname}${u.search}`.slice(0, 500) || '/'
    return raw.slice(0, 500)
  } catch {
    return '/'
  }
}
