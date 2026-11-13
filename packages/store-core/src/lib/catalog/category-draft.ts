import { mergeAndPublish, type DraftAdapter } from '@/lib/admin/draft-branches'
import type { Resolution } from '@/lib/admin/draft-merge'
import type { DraftActor, DraftDb } from '@/lib/admin/draft-locks'
import { CATEGORY_PROFILE_FIELDS } from './category-fields'
import { contentOfSpecs, specLabels, specUpdate } from './entity-fields'

/** Writes the profile columns (category-fields.ts) present in `f`; older drafts without them keep live values. */
export async function applyCategoryProfile(db: DraftDb, categoryId: string, f: Record<string, unknown>) {
  const upd = specUpdate(CATEGORY_PROFILE_FIELDS, f, 2)
  if (upd) await db.query(`UPDATE categories SET ${upd.set} WHERE id = $1`, [categoryId, ...upd.params])
}

const slugOf = (name: unknown) =>
  typeof name === 'string' && name
    ? name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : null

/** Reorder reminder interval: 1–365 days, anything else clears it (the parent's value then applies). */
export function reorderIntervalDays(v: unknown): number | null {
  const n = parseInt(String(v ?? ''), 10)
  return n >= 1 && n <= 365 ? n : null
}

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
       image_url = CASE WHEN $15::boolean THEN $16 ELSE image_url END,
       hero_image_mobile = CASE WHEN $17::boolean THEN $18 ELSE hero_image_mobile END,
       hero_image_desktop = CASE WHEN $19::boolean THEN $20 ELSE hero_image_desktop END,
       reorder_interval_days = CASE WHEN $21::boolean THEN $22::integer ELSE reorder_interval_days END,
       updated_at = NOW()
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
      // Drafts saved before a field existed keep the live value.
      'image_url' in f,
      f.image_url || null,
      'hero_image_mobile' in f,
      f.hero_image_mobile || null,
      'hero_image_desktop' in f,
      f.hero_image_desktop || null,
      'reorder_interval_days' in f,
      reorderIntervalDays(f.reorder_interval_days),
    ]
  )

  await applyCategoryProfile(db, categoryId, f)
  if (f.is_active != null && f.is_active !== prevIsActive) {
    await db.query(`UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, categoryId])
    const subcats = await db.query<{ id: string }>(`SELECT id FROM categories WHERE parent_category_id = $1`, [categoryId])
    for (const sub of subcats.rows) {
      await db.query(`UPDATE categories SET is_active = $1, updated_at = NOW() WHERE id = $2`, [f.is_active, sub.id])
      await db.query(`UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, sub.id])
    }
  }
}

const BASE_COLS = [
  'name', 'description', 'image_url', 'parent_category_id', 'display_order', 'is_active', 'sku_prefix',
  'google_product_category', 'icon_name', 'return_allowed', 'return_window_days', 'replacement_allowed', 'replacement_window_days',
  'hero_image_mobile', 'hero_image_desktop', 'reorder_interval_days',
] as const
const CONTENT_COLS = [...BASE_COLS, ...CATEGORY_PROFILE_FIELDS.map(f => f.key)]

/** A categories row in the shape the form saves (slug follows name, so it is not merged on its own). */
export function categoryContentOf(row: Record<string, any>): Record<string, unknown> {
  const c: Record<string, unknown> = {
    ...Object.fromEntries(BASE_COLS.map(k => [k, row[k] ?? null])),
    ...contentOfSpecs(CATEGORY_PROFILE_FIELDS, row),
  }
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
    ...specLabels(CATEGORY_PROFILE_FIELDS),
    parent_category_id: 'Parent category',
    sku_prefix: 'SKU prefix',
    google_product_category: 'Google product category',
    icon_name: 'Icon',
    image_url: 'Image',
    hero_image_mobile: 'Banner (mobile)',
    hero_image_desktop: 'Banner (desktop)',
    reorder_interval_days: 'Reorder reminder (days)',
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
