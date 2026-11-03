import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'

/** The offer columns a draft carries (media goes straight to live). */
export const OFFER_FIELDS = [
  'title', 'slug', 'subtitle', 'badge_text', 'badge_color', 'cta_label', 'starts_at', 'ends_at', 'is_active', 'display_order',
] as const
const DATES = new Set<string>(['starts_at', 'ends_at'])

// Dates compare as ISO instants: the db, jsonb and the editor each format them differently.
const iso = (v: unknown) => {
  if (v == null || v === '') return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? v : d.toISOString()
}

/** The draftable offer fields present in `src`, dates normalised. */
export function offerFieldsOf(src: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(OFFER_FIELDS.filter(k => k in src).map(k => [k, DATES.has(k) ? iso(src[k]) : (src[k] ?? null)]))
}

// Products merge per element ({ id }), so two drafts adding different products both land.
const productEls = (ids: unknown) => ((Array.isArray(ids) ? ids : []) as string[]).map(id => ({ id }))

export async function liveOfferContent(db: DraftDb, offerId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(
    `SELECT ${OFFER_FIELDS.join(', ')},
            COALESCE((SELECT jsonb_agg(product_id ORDER BY product_id) FROM product_offer_items WHERE offer_id = po.id), '[]'::jsonb) AS products
       FROM product_offers po WHERE po.id = $1`,
    [offerId]
  )
  const row = r.rows[0]
  return row ? { ...offerFieldsOf(row), products: productEls(row.products) } : null
}

/** Writes merged content to the live offer and replaces its product membership. */
export async function applyOfferContent(db: DraftDb, offerId: string, c: Record<string, any>) {
  const cols = OFFER_FIELDS.filter(k => k in c)
  if (cols.length > 0)
    await db.query(
      `UPDATE product_offers SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
      [...cols.map(k => c[k]), offerId]
    )
  if (Array.isArray(c.products)) {
    const ids = (c.products as { id: string }[]).map(p => p.id)
    await db.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [offerId])
    if (ids.length > 0)
      await db.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
         SELECT $1, pid FROM unnest($2::uuid[]) AS pid
         ON CONFLICT DO NOTHING`,
        [offerId, ids]
      )
  }
}

export const offerDrafts: DraftAdapter = {
  type: 'offer',
  table: 'offer_drafts',
  entityKey: 'offer_id',
  arrayKeys: { products: 'id' },
  labels: {
    badge_text: 'Badge',
    badge_color: 'Badge colour',
    cta_label: 'Button label',
    starts_at: 'Launch date',
    ends_at: 'End date',
    is_active: 'Active',
    display_order: 'Display order',
    products: 'Product',
  },
  live: liveOfferContent,
  // offer_drafts.fields is patched field by field (older rows cloned every column): keep the draftable ones.
  toContent: row => ({
    ...offerFieldsOf((row.base ?? {}) as Record<string, unknown>),
    ...offerFieldsOf((row.fields ?? {}) as Record<string, unknown>),
    products: productEls(row.products),
  }),
  toColumns: c => {
    const { products, ...fields } = c
    return { fields, products: ((products ?? []) as { id: string }[]).map(p => p.id) }
  },
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM product_offers WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged) => applyOfferContent(db, id, merged),
}

/** Merge an offer draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishOfferDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(offerDrafts, draftId, opts.actor, opts)
}
