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

/** Writes draft content to the live category and cascades an is_active change to products and subcategories. */
export async function applyCategoryContent(db: DraftDb, categoryId: string, f: Record<string, any>, prevIsActive: boolean | null | undefined) {
  await db.query(
    `UPDATE categories SET
       name = COALESCE($2, name), slug = COALESCE($3, slug),
       description = $4, parent_category_id = $5::uuid,
       display_order = COALESCE($6, display_order), sku_prefix = $7,
       is_active = COALESCE($8::boolean, is_active),
       return_allowed = $9::boolean, return_window_days = $10::integer,
       replacement_allowed = $11::boolean, replacement_window_days = $12::integer,
       google_product_category = $13, icon_name = $14,
       image_url = CASE WHEN $15::boolean THEN $16 ELSE image_url END, updated_at = NOW()
     WHERE id = $1`,
    [
      categoryId,
      f.name || null,
      slugOf(f.name),
      f.description ?? null,
      f.parent_category_id || null,
      f.display_order != null && f.display_order !== '' ? parseInt(f.display_order) : null,
      f.sku_prefix || null,
      f.is_active != null ? f.is_active : null,
      f.return_allowed != null ? f.return_allowed : null,
      f.return_window_days != null ? parseInt(f.return_window_days) : null,
      f.replacement_allowed != null ? f.replacement_allowed : null,
      f.replacement_window_days != null ? parseInt(f.replacement_window_days) : null,
      f.google_product_category || null,
      f.icon_name || null,
      // Drafts saved before the image field keep the live image.
      'image_url' in f,
      f.image_url || null,
    ]
  )

  if (f.is_active != null && f.is_active !== prevIsActive) {
    await db.query(`UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, categoryId])
    const subcats = await db.query<{ id: string }>(`SELECT id FROM categories WHERE parent_category_id = $1`, [categoryId])
    for (const sub of subcats.rows) {
      await db.query(`UPDATE categories SET is_active = $1, updated_at = NOW() WHERE id = $2`, [f.is_active, sub.id])
      await db.query(`UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, sub.id])
    }
  }
}

const CONTENT_COLS = [
  'name', 'description', 'image_url', 'parent_category_id', 'display_order', 'is_active', 'sku_prefix',
  'google_product_category', 'icon_name', 'return_allowed', 'return_window_days', 'replacement_allowed', 'replacement_window_days',
] as const

/** A categories row in the shape the form saves (slug follows name, so it is not merged on its own). */
export function categoryContentOf(row: Record<string, any>): Record<string, unknown> {
  const c: Record<string, unknown> = Object.fromEntries(CONTENT_COLS.map(k => [k, row[k] ?? null]))
  c.policy_override = row.return_allowed != null || row.replacement_allowed != null
  return c
}

export async function liveCategoryContent(db: DraftDb, categoryId: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT ${CONTENT_COLS.join(', ')} FROM categories WHERE id = $1`, [categoryId])
  return r.rows[0] ? categoryContentOf(r.rows[0]) : null
}

export const categoryDrafts: DraftAdapter = {
  type: 'category',
  table: 'category_drafts',
  entityKey: 'category_id',
  labels: {
    parent_category_id: 'Parent category',
    sku_prefix: 'SKU prefix',
    google_product_category: 'Google product category',
    icon_name: 'Icon',
    image_url: 'Image',
    is_active: 'Active',
    policy_override: 'Own return policy',
  },
  live: liveCategoryContent,
  toContent: row => {
    const { slug: _slug, ...f } = (row.fields ?? {}) as Record<string, unknown>
    return f
  },
  toColumns: c => ({ fields: c }),
  lockLive: async (db, id) => {
    await db.query(`SELECT 1 FROM categories WHERE id = $1 FOR UPDATE`, [id])
  },
  apply: (db, id, merged, live) => applyCategoryContent(db, id, merged, live.is_active as boolean | null),
}

/** Merge a category draft into live. Throws DraftConflictError while overlapping edits are unresolved. */
export function publishCategoryDraft(
  draftId: string,
  opts: { actor?: DraftActor; resolutions?: Record<string, Resolution>; epoch?: number | null } = {}
) {
  return mergeAndPublish(categoryDrafts, draftId, opts.actor, opts)
}
