import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'

/**
 * Writes draft content to the live coupon. A never-published coupon goes live and active.
 * Validity dates equal to live are left as stored: the form's datetime-local strings would
 * otherwise be re-read in the DB session time zone and shift.
 */
export async function applyCouponContent(db: DraftDb, couponId: string, f: Record<string, any>, live?: Record<string, unknown> | null) {
  await db.query(
    `UPDATE coupons SET
       code = COALESCE($2, code),
       description = $3,
       discount_type = COALESCE($4, discount_type),
       discount_value = COALESCE($5::numeric, discount_value),
       min_purchase_amount = $6::numeric,
       max_discount_amount = $7::numeric,
       usage_limit = $8::integer,
       usage_limit_per_user = $9::integer,
       valid_from = CASE WHEN $13::boolean THEN valid_from ELSE $10::timestamptz END,
       valid_until = CASE WHEN $14::boolean THEN valid_until ELSE $11::timestamptz END,
       is_active = CASE WHEN is_draft THEN true ELSE COALESCE($12::boolean, is_active) END,
       is_draft = false
     WHERE id = $1`,
    [
      couponId,
      f.code ? String(f.code).toUpperCase() : null,
      f.description ?? null,
      f.discount_type || null,
      f.discount_value != null ? f.discount_value : null,
      f.min_purchase_amount ?? null,
      f.max_discount_amount ?? null,
      f.usage_limit ?? null,
      f.usage_limit_per_user ?? null,
      f.valid_from || null,
      f.valid_until || null,
      f.is_active != null ? f.is_active : null,
      !!live && dt(f.valid_from) === live.valid_from,
      !!live && dt(f.valid_until) === live.valid_until,
    ]
  )
}

const CONTENT_COLS = [
  'code', 'description', 'discount_type', 'discount_value', 'min_purchase_amount', 'max_discount_amount',
  'usage_limit', 'usage_limit_per_user', 'valid_from', 'valid_until', 'is_active',
] as const

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
// The form posts datetime-local strings (UTC wall time, see the edit page); live rows are Dates.
const dt = (v: unknown) => {
  if (v == null || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return v
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? v : d.toISOString().slice(0, 16)
}

function normalize(c: Record<string, unknown>): Record<string, unknown> {
  const out = { ...c }
  for (const k of ['discount_value', 'min_purchase_amount', 'max_discount_amount', 'usage_limit', 'usage_limit_per_user'])
    if (k in out) out[k] = num(out[k])
  for (const k of ['valid_from', 'valid_until']) if (k in out) out[k] = dt(out[k])
  return out
}

/** A coupons row in the shape the edit form saves. */
export function couponContentOf(row: Record<string, any>): Record<string, unknown> {
  return normalize(Object.fromEntries(CONTENT_COLS.map(k => [k, row[k] ?? null])))
}

export async function liveCouponContent(db: DraftDb, couponId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT ${CONTENT_COLS.join(', ')} FROM coupons WHERE id = $1`, [couponId])
  return r.rows[0] ? couponContentOf(r.rows[0]) : null
}

export const couponDrafts: DraftAdapter = {
  type: 'coupon',
  table: 'coupon_drafts',
  entityKey: 'coupon_id',
  labels: {
    min_purchase_amount: 'Minimum purchase',
    max_discount_amount: 'Maximum discount',
    usage_limit: 'Usage limit',
    usage_limit_per_user: 'Per-user limit',
    valid_from: 'Valid from',
    valid_until: 'Valid until',
    is_active: 'Active',
  },
  live: liveCouponContent,
  // Older drafts copied the whole row (times_used, is_draft, …): keep only the form's fields.
  toContent: row => {
    const f = (row.fields ?? {}) as Record<string, unknown>
    return normalize(Object.fromEntries(CONTENT_COLS.filter(k => k in f).map(k => [k, f[k]])))
  },
  toColumns: c => ({ fields: c }),
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM coupons WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged, live) => applyCouponContent(db, id, merged, live),
}

/** Merge a coupon draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishCouponDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(couponDrafts, draftId, opts.actor, opts)
}
