import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'

/** Writes draft content to the live review form. */
export async function applyReviewFormContent(db: DraftDb, formId: string, f: Record<string, any>) {
  await db.query(
    `UPDATE review_forms SET
       title = COALESCE($2, title),
       slug = COALESCE($3, slug),
       template_type = COALESCE($4, template_type),
       google_review_url = COALESCE($5, google_review_url),
       coupon_id = $6::uuid,
       description = $7,
       is_active = COALESCE($8::boolean, is_active),
       custom_fields = COALESCE($9::jsonb, custom_fields)
     WHERE id = $1`,
    [
      formId,
      f.title || null,
      f.slug || null,
      f.template_type || null,
      f.google_review_url || null,
      f.coupon_id || null,
      f.description ?? null,
      f.is_active != null ? f.is_active : null,
      f.custom_fields ? JSON.stringify(f.custom_fields) : null,
    ]
  )
}

const CONTENT_COLS = ['title', 'slug', 'template_type', 'google_review_url', 'coupon_id', 'description', 'is_active', 'custom_fields'] as const

/** A review_forms row in the shape the edit form saves. */
export function reviewFormContentOf(row: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(CONTENT_COLS.map(k => [k, row[k] ?? (k === 'custom_fields' ? [] : null)]))
}

export async function liveReviewFormContent(db: DraftDb, formId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT ${CONTENT_COLS.join(', ')} FROM review_forms WHERE id = $1`, [formId])
  return r.rows[0] ? reviewFormContentOf(r.rows[0]) : null
}

export const reviewFormDrafts: DraftAdapter = {
  type: 'review_form',
  table: 'review_form_drafts',
  entityKey: 'form_id',
  // Custom fields merge per field (each carries an id), so two admins can edit different ones.
  arrayKeys: { custom_fields: 'id' },
  labels: {
    slug: 'URL slug',
    template_type: 'Template',
    google_review_url: 'Google review URL',
    coupon_id: 'Reward coupon',
    is_active: 'Active',
    custom_fields: 'Custom field',
  },
  live: liveReviewFormContent,
  // Older drafts copied the whole row (submissions_count, is_draft, …): keep only the form's fields.
  toContent: row => {
    const f = (row.fields ?? {}) as Record<string, unknown>
    return Object.fromEntries(CONTENT_COLS.filter(k => k in f).map(k => [k, f[k]]))
  },
  toColumns: c => ({ fields: c }),
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM review_forms WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged) => applyReviewFormContent(db, id, merged),
}

/** Merge a review form draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishReviewFormDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(reviewFormDrafts, draftId, opts.actor, opts)
}
