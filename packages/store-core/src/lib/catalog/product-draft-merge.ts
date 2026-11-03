import { createHash } from 'crypto'
import type { DraftDb } from '@/lib/admin/draft-locks'
import { DraftConflictError } from '@/lib/admin/draft-branches'
import { project, threeWayMerge, type Content, type MergeConflict, type Resolution } from '@/lib/admin/draft-merge'
import { lastTouch, revisionsSince } from '@/lib/admin/entity-revisions'

// Product drafts merge like other drafts (docs/plans/MULTI_DRAFT_PLAN.md) with two differences:
// the draft is a snapshot of several tables, so each related set (variants, images, …) merges as
// one value; and only fields the draft carries take part, so columns the form never edits
// (ratings, counters) cannot raise conflicts.

/** The live product in the shape a new draft is seeded with. $1 = product id. */
export const PRODUCT_SNAPSHOT_SELECT = `
  SELECT
    to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'search_vector' - 'views_count' - 'sales_count' - 'inventory_quantity' AS fields,
    COALESCE((SELECT json_agg(to_jsonb(v) || jsonb_build_object('sub_variant_type_on',
                v.sub_variant_type_on OR EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active = true)))
              FROM product_variants v WHERE v.product_id = p.id), '[]')::jsonb AS variants,
    COALESCE((SELECT json_agg(to_jsonb(i) ORDER BY i.display_order) FROM product_images i WHERE i.product_id = p.id), '[]')::jsonb AS images,
    COALESCE((SELECT json_agg(to_jsonb(sv) ORDER BY sv.created_at, sv.sub_variant_name)
              FROM product_sub_variants sv
              JOIN product_variants v ON v.id = sv.variant_id
              WHERE v.product_id = p.id AND sv.is_active = true), '[]')::jsonb AS sub_variants,
    COALESCE((SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = p.id), '[]')::jsonb AS units,
    COALESCE((SELECT json_agg(to_jsonb(vi) ORDER BY vi.display_order)
              FROM variant_images vi
              JOIN product_variants v ON v.id = vi.variant_id
              WHERE v.product_id = p.id), '[]')::jsonb AS variant_images
  FROM products p WHERE p.id = $1`

export const PRODUCT_SETS = ['variants', 'images', 'sub_variants', 'units', 'variant_images'] as const

export interface ProductSnapshot {
  fields: Record<string, unknown>
  variants: unknown[]
  images: unknown[]
  sub_variants: unknown[]
  units: unknown[]
  variant_images: unknown[]
}

const LABELS: Record<string, string> = {
  variants: 'Variants',
  images: 'Product images',
  sub_variants: 'Sub-variants',
  units: 'Selling units',
  variant_images: 'Variant images',
  base_price: 'Price',
  mrp: 'MRP',
  mrp_ex_gst: 'MRP (ex GST)',
  price_ex_gst: 'Price (ex GST)',
  gst_percentage: 'GST %',
  hsn_code: 'HSN code',
  category_id: 'Category',
  brand_id: 'Brand',
  supplier_id: 'Preferred supplier',
  product_suppliers: 'Suppliers',
  meta_title: 'SEO title',
  meta_description: 'SEO description',
  sku: 'SKU',
  mpn: 'MPN',
  gtin: 'GTIN',
  isbn: 'ISBN',
  asin: 'ASIN',
}

export async function liveProductSnapshot(db: DraftDb, productId: string): Promise<ProductSnapshot | null> {
  const r = await db.query<ProductSnapshot>(PRODUCT_SNAPSHOT_SELECT, [productId])
  return r.rows[0] ?? null
}

// Fields and sets side by side; `_`-prefixed draft keys (UI state such as _bsEntries) never merge.
function flat(s: Partial<ProductSnapshot> | null | undefined): Content {
  const out: Content = {}
  for (const [k, v] of Object.entries(s?.fields ?? {})) if (!k.startsWith('_')) out[k] = v
  for (const k of PRODUCT_SETS) if (s && k in s) out[k] = s[k]
  return out
}

const count = (v: unknown) => (Array.isArray(v) ? v.filter((x: any) => !x?._isDeleted && !x?._cleared).length : 0)

/** Sets go into revisions as a count + fingerprint, not the whole array. */
function fingerprint(c: Content): Content {
  const out: Content = { ...c }
  for (const k of PRODUCT_SETS)
    if (k in out) out[k] = `${count(out[k])} · ${createHash('sha1').update(JSON.stringify(out[k] ?? [])).digest('hex').slice(0, 10)}`
  return out
}

function describeSet(k: string, v: unknown): string {
  const n = count(v)
  const names = Array.isArray(v)
    ? v
        .filter((x: any) => !x?._isDeleted && !x?._cleared)
        .map((x: any) => x?.variant_name ?? x?.sub_variant_name ?? x?.unit_name ?? x?.alt_text ?? null)
        .filter(Boolean)
        .slice(0, 6)
    : []
  return `${n} ${LABELS[k]?.toLowerCase() ?? k}${names.length ? `: ${names.join(', ')}${n > names.length ? '…' : ''}` : ''}`
}

export interface ProductMerge {
  /** Content to publish (replaces the draft's fields and sets). */
  merged: ProductSnapshot
  /** Live and merged, fingerprinted, for the revision row. */
  before: Content
  after: Content
}

/**
 * Three-way merge of a product draft. A draft without a base (from before branches, or an
 * import) publishes as is. Throws DraftConflictError while overlapping edits are unresolved.
 */
export async function mergeProductDraft(
  db: DraftDb,
  draft: ProductSnapshot & { product_id: string; base?: ProductSnapshot | null; base_revision?: number | null },
  live: ProductSnapshot,
  resolutions?: Record<string, Resolution>
): Promise<ProductMerge> {
  const mine = flat(draft)
  const liveP = project(flat(live), [mine])
  if (!draft.base) return { merged: draft, before: fingerprint(liveP), after: fingerprint(mine) }

  const r = threeWayMerge(project(flat(draft.base), [mine]), mine, liveP, { labels: LABELS, resolutions })
  if (r.conflicts.length) {
    const revs = await revisionsSince(db, 'product', draft.product_id, draft.base_revision ?? 0)
    const conflicts: MergeConflict[] = r.conflicts.map(c => {
      const t = lastTouch(revs, c.path)
      const set = (PRODUCT_SETS as readonly string[]).includes(c.path)
      return {
        ...c,
        ...(set ? { base: describeSet(c.path, c.base), theirs: describeSet(c.path, c.theirs), mine: describeSet(c.path, c.mine) } : {}),
        theirsBy: t ? (t.actor_name ?? (t.source === 'publish' ? 'Another admin' : `a ${t.source} change`)) : 'a change outside drafts',
        theirsAt: t?.created_at ?? null,
      }
    })
    throw new DraftConflictError(conflicts, revs[0]?.revision ?? draft.base_revision ?? 0)
  }

  // Keys only the draft has (and its `_` keys) pass through untouched.
  const fields: Record<string, unknown> = { ...draft.fields }
  for (const [k, v] of Object.entries(r.merged)) if (!(PRODUCT_SETS as readonly string[]).includes(k)) fields[k] = v
  const merged: ProductSnapshot = { ...draft, fields }
  for (const k of PRODUCT_SETS) if (k in r.merged) (merged as any)[k] = r.merged[k]
  return { merged, before: fingerprint(liveP), after: fingerprint(r.merged) }
}
