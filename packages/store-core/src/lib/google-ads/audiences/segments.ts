import { z } from 'zod'
import { dmUserIdentifiers, sha256Hex, type DataManagerIdentifier } from '../conversions/hash'

// Customer Match segments built from the store's own orders. Only customers whose latest order
// carried ad consent (orders.ads_consent from the cookie banner) are uploaded: there is no
// account-level advertising consent, so the latest order's choice stands in for it. Guests,
// inactive accounts and customers who opted out of marketing are never included.

export const SEGMENTS = ['repeat_buyers', 'lapsed', 'high_value', 'recent_buyers', 'b2b'] as const
export type Segment = (typeof SEGMENTS)[number]

export const SegmentParamsSchema = z.object({
  minOrders: z.number().int().min(2).max(50).optional(),
  days: z.number().int().min(7).max(1095).optional(),
  topPercent: z.number().min(1).max(50).optional(),
})
export type SegmentParams = z.infer<typeof SegmentParamsSchema>

export interface SegmentDef {
  label: string
  description: (p: Required<SegmentParams>) => string
  /** How the console suggests using it. */
  use: string
  defaults: SegmentParams
}

export const SEGMENT_DEFS: Record<Segment, SegmentDef> = {
  repeat_buyers: {
    label: 'Repeat buyers',
    description: p => `Customers with ${p.minOrders} or more paid orders`,
    use: 'Audience signal for Performance Max; observation on Search to bid up loyal buyers.',
    defaults: { minOrders: 2 },
  },
  lapsed: {
    label: 'Lapsed customers',
    description: p => `Bought before, but no paid order in the last ${p.days} days`,
    use: 'Win-back: target or observe on Search, signal for Performance Max.',
    defaults: { days: 180 },
  },
  high_value: {
    label: 'High-value customers',
    description: p => `Top ${p.topPercent}% of customers by total spend`,
    use: 'Audience signal for Performance Max (find more people like them).',
    defaults: { topPercent: 10 },
  },
  recent_buyers: {
    label: 'Recent buyers',
    description: p => `Paid order in the last ${p.days} days`,
    use: 'Exclude from prospecting campaigns so you do not pay for clicks from people who just bought.',
    defaults: { days: 30 },
  },
  b2b: {
    label: 'Business accounts',
    description: () => 'Approved business (B2B) accounts with at least one paid order',
    use: 'Observation on Search to see and bid on business buyers.',
    defaults: {},
  },
}

const FALLBACK: Required<SegmentParams> = { minOrders: 2, days: 180, topPercent: 10 }

export function segmentParams(segment: Segment, stored: unknown): Required<SegmentParams> {
  const parsed = SegmentParamsSchema.safeParse(stored ?? {})
  return { ...FALLBACK, ...SEGMENT_DEFS[segment].defaults, ...(parsed.success ? parsed.data : {}) }
}

export const isSegment = (v: unknown): v is Segment => typeof v === 'string' && (SEGMENTS as readonly string[]).includes(v)

const PAID = `o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')`

/**
 * Every customer in the segment, with whether their latest order consented to ads. Values are
 * bound, never interpolated. `consented` decides upload; the rest are only counted.
 */
export function segmentQuery(segment: Segment, p: Required<SegmentParams>): { sql: string; values: unknown[] } {
  const values: unknown[] = []
  const bind = (v: unknown) => {
    values.push(v)
    return `$${values.length}`
  }
  let where: string
  switch (segment) {
    case 'repeat_buyers':
      where = `p.orders >= ${bind(p.minOrders)}`
      break
    case 'lapsed':
      where = `p.last_at < now() - make_interval(days => ${bind(p.days)})`
      break
    case 'recent_buyers':
      where = `p.last_at >= now() - make_interval(days => ${bind(p.days)})`
      break
    case 'high_value':
      where = `p.spend > 0 AND p.spend >= (SELECT percentile_cont(1 - ${bind(p.topPercent / 100)}::float8) WITHIN GROUP (ORDER BY spend) FROM paid)`
      break
    case 'b2b':
      where = `EXISTS (SELECT 1 FROM business_profiles bp WHERE bp.user_id = u.id AND bp.approval_status = 'approved')`
      break
  }
  const sql = `WITH paid AS (
       SELECT o.user_id, COUNT(*)::int AS orders, SUM(o.total_amount) AS spend, MAX(o.created_at) AS last_at
       FROM orders o
       WHERE o.user_id IS NOT NULL AND ${PAID}
       GROUP BY o.user_id
     ), latest AS (
       SELECT DISTINCT ON (o.user_id) o.user_id, o.ads_consent, o.customer_phone
       FROM orders o WHERE o.user_id IS NOT NULL
       ORDER BY o.user_id, o.created_at DESC
     )
     SELECT u.id::text AS user_id, u.email, COALESCE(NULLIF(u.phone, ''), l.customer_phone) AS phone,
            (l.ads_consent IS TRUE) AS consented
     FROM paid p
     JOIN users u ON u.id = p.user_id
     JOIN latest l ON l.user_id = u.id
     WHERE u.is_guest IS NOT TRUE AND u.email NOT ILIKE '%@temporary.local'
       AND u.is_active IS NOT FALSE AND u.marketing_opt_out IS NOT TRUE
       AND ${where}`
  return { sql, values }
}

export interface SegmentRow {
  user_id: string
  email: string | null
  phone: string | null
  consented: boolean
}

export interface AudienceMember {
  userId: string
  identifiers: DataManagerIdentifier[]
  fingerprint: string
}

/** Consented customers with at least one usable identifier, hashed per Google's rules. */
export function toMembers(rows: SegmentRow[]): AudienceMember[] {
  const out: AudienceMember[] = []
  for (const r of rows) {
    if (!r.consented) continue
    const identifiers = dmUserIdentifiers(r.email, r.phone)
    if (!identifiers.length) continue
    out.push({ userId: r.user_id, identifiers, fingerprint: fingerprintOf(identifiers) })
  }
  return out
}

export function fingerprintOf(ids: DataManagerIdentifier[]): string {
  return sha256Hex(
    ids
      .map(i => ('emailAddress' in i ? `e:${i.emailAddress}` : `p:${i.phoneNumber}`))
      .sort()
      .join('|')
  )
}

export interface MemberDiff {
  add: AudienceMember[]
  remove: { userId: string; identifiers: DataManagerIdentifier[] }[]
}

/** What to send: new or changed members in, departed members (and stale identifiers) out. */
export function diffMembers(current: AudienceMember[], uploaded: { user_id: string; identifiers: DataManagerIdentifier[]; fingerprint: string }[]): MemberDiff {
  const now = new Map(current.map(m => [m.userId, m]))
  const before = new Map(uploaded.map(u => [u.user_id, u]))
  const add: AudienceMember[] = []
  const remove: MemberDiff['remove'] = []
  for (const m of current) {
    const prev = before.get(m.userId)
    if (!prev) add.push(m)
    else if (prev.fingerprint.trim() !== m.fingerprint) {
      remove.push({ userId: prev.user_id, identifiers: prev.identifiers })
      add.push(m)
    }
  }
  for (const u of uploaded) if (!now.has(u.user_id)) remove.push({ userId: u.user_id, identifiers: u.identifiers })
  return { add, remove }
}
