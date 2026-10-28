import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'

const slugOf = (name: unknown) =>
  typeof name === 'string' && name
    ? name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : null

/**
 * Writes draft content to the live brand. A never-published brand goes live and active; an
 * is_active change cascades to the brand's products.
 */
export async function applyBrandContent(db: DraftDb, brandId: string, f: Record<string, any>, prevIsActive: boolean | null | undefined) {
  await db.query(
    `UPDATE brands SET
       name = COALESCE($2, name),
       slug = COALESCE($3, slug),
       description = $4,
       website = $5,
       logo_url = $6,
       is_active = CASE WHEN is_draft THEN true ELSE COALESCE($7::boolean, is_active) END,
       is_draft = false,
       return_allowed = COALESCE($8::boolean, return_allowed),
       return_window_days = COALESCE($9::integer, return_window_days),
       replacement_allowed = COALESCE($10::boolean, replacement_allowed),
       replacement_window_days = COALESCE($11::integer, replacement_window_days)
     WHERE id = $1`,
    [
      brandId,
      f.name || null,
      f.slug || slugOf(f.name),
      f.description ?? null,
      f.website ?? null,
      f.logo_url ?? null,
      f.is_active != null ? f.is_active : null,
      f.return_allowed != null ? f.return_allowed : null,
      f.return_window_days != null ? parseInt(f.return_window_days) : null,
      f.replacement_allowed != null ? f.replacement_allowed : null,
      f.replacement_window_days != null ? parseInt(f.replacement_window_days) : null,
    ]
  )
  if (f.is_active != null && f.is_active !== prevIsActive) {
    await db.query(`UPDATE products SET is_active = $1 WHERE brand_id = $2`, [f.is_active, brandId])
  }
}

const CONTENT_COLS = [
  'name', 'slug', 'description', 'website', 'logo_url', 'is_active',
  'return_allowed', 'return_window_days', 'replacement_allowed', 'replacement_window_days',
] as const

/** A brands row in the shape the edit form saves. */
export function brandContentOf(row: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(CONTENT_COLS.map(k => [k, row[k] ?? null]))
}

export async function liveBrandContent(db: DraftDb, brandId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT ${CONTENT_COLS.join(', ')} FROM brands WHERE id = $1`, [brandId])
  return r.rows[0] ? brandContentOf(r.rows[0]) : null
}

export const brandDrafts: DraftAdapter = {
  type: 'brand',
  table: 'brand_drafts',
  entityKey: 'brand_id',
  labels: {
    logo_url: 'Logo',
    is_active: 'Active',
    return_allowed: 'Returns allowed',
    return_window_days: 'Return window (days)',
    replacement_allowed: 'Replacement allowed',
    replacement_window_days: 'Replacement window (days)',
  },
  live: liveBrandContent,
  // Older drafts copied the whole row (is_draft, …): keep only the form's fields.
  toContent: row => {
    const f = (row.fields ?? {}) as Record<string, unknown>
    return Object.fromEntries(CONTENT_COLS.filter(k => k in f).map(k => [k, f[k]]))
  },
  toColumns: c => ({ fields: c }),
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM brands WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged, live) => applyBrandContent(db, id, merged, live.is_active as boolean | null),
}

/** Merge a brand draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishBrandDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(brandDrafts, draftId, opts.actor, opts)
}
