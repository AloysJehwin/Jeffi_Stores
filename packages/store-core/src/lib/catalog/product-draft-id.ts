import { queryMany, queryOne } from '@/lib/shared/db'
import type { DraftListing } from '@/lib/admin/draft-branches'
import { acquireDraftLock, draftLockChips, withDraftCreate, type DraftActor } from '@/lib/admin/draft-locks'
import { currentRevision } from '@/lib/admin/entity-revisions'
import { PRODUCT_SNAPSHOT_SELECT } from './product-draft-merge'

/**
 * The product draft a request addresses: `?draft=<id>` (checked against the product), else the
 * caller's own newest draft of it. Null when there is none.
 */
export async function productDraftIdFor(
  req: { nextUrl: { searchParams: URLSearchParams } },
  productId: string,
  adminId?: string | null
): Promise<string | null> {
  const asked = req.nextUrl.searchParams.get('draft')
  if (asked) {
    const r = await queryOne<{ id: string }>(`SELECT id FROM product_drafts WHERE id = $1 AND product_id = $2`, [asked, productId])
    return r?.id ?? null
  }
  if (!adminId) return null
  const own = await queryOne<{ id: string }>(
    `SELECT id FROM product_drafts WHERE product_id = $1 AND author_admin_id = $2 ORDER BY updated_at DESC LIMIT 1`,
    [productId, adminId]
  )
  return own?.id ?? null
}

/** For the editor's "live changed since you started" banner: [behind, other drafts open]. */
export async function draftBehindFor(draftId: string) {
  const r = await queryOne<{ behind: number; siblings: number; last_by: string | null; last_at: string | null; last_title: string | null }>(
    // A draft from before branches has no base: it publishes as is, so it is never "behind".
    `SELECT CASE WHEN d.base IS NULL THEN 0 ELSE (SELECT COUNT(*)::int FROM entity_revisions er
              WHERE er.resource_type = 'product' AND er.resource_id = d.product_id AND er.revision > d.base_revision) END AS behind,
            (SELECT COUNT(*)::int FROM product_drafts o WHERE o.product_id = d.product_id AND o.id <> d.id) AS siblings,
            lr.actor_name AS last_by, lr.created_at AS last_at, lr.draft_title AS last_title
       FROM product_drafts d
       LEFT JOIN LATERAL (SELECT actor_name, created_at, draft_title FROM entity_revisions
                           WHERE resource_type = 'product' AND resource_id = d.product_id AND revision > d.base_revision
                           ORDER BY revision DESC LIMIT 1) lr ON true
      WHERE d.id = $1`,
    [draftId]
  )
  if (!r) return [null, 0] as const
  const info = r.behind ? { behind: r.behind, last: { by: r.last_by, at: r.last_at!, draftTitle: r.last_title, fields: 0 } } : null
  return [info, r.siblings] as const
}

/**
 * The actor's draft of the product (locked to them), or a new one seeded from live with that
 * snapshot as its merge base. `fresh` starts another alongside an existing one.
 */
export async function startProductDraft(
  actor: DraftActor,
  productId: string,
  opts: { fresh?: boolean; title?: string | null } = {}
): Promise<{ draftId: string; existing: boolean }> {
  if (!opts.fresh && actor?.adminId) {
    const own = await queryOne<{ id: string }>(
      `SELECT id FROM product_drafts WHERE product_id = $1 AND author_admin_id = $2 ORDER BY updated_at DESC LIMIT 1`,
      [productId, actor.adminId]
    )
    if (own) {
      await acquireDraftLock(actor, 'product', own.id)
      return { draftId: own.id, existing: true }
    }
  }
  const draftId = (await queryOne<{ id: string }>(`SELECT gen_random_uuid() AS id`))!.id
  await withDraftCreate(actor, 'product', draftId, async db => {
    const rev = await currentRevision(db, 'product', productId)
    await db.query(
      `INSERT INTO product_drafts (id, product_id, author_admin_id, title, base, base_revision,
                                   fields, variants, images, sub_variants, units, variant_images)
       SELECT $2, $1, $3, $4,
              jsonb_build_object('fields', s.fields, 'variants', s.variants, 'images', s.images,
                                 'sub_variants', s.sub_variants, 'units', s.units, 'variant_images', s.variant_images),
              $5, s.fields, s.variants, s.images, s.sub_variants, s.units, s.variant_images
         FROM (${PRODUCT_SNAPSHOT_SELECT}) s`,
      [productId, draftId, actor?.adminId ?? null, opts.title?.trim().slice(0, 120) || null, rev]
    )
  })
  return { draftId, existing: false }
}

/** The product page's drafts panel: each open draft, who holds it, and publishes since it started. */
export async function draftsForProduct(productId: string, me?: string | null): Promise<DraftListing[]> {
  const rows = await queryMany<any>(
    `SELECT d.id, d.title, d.author_admin_id, d.base_revision, d.updated_at, d.base IS NOT NULL AS has_base,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS author_name,
            (SELECT COALESCE(MAX(revision), 0) FROM entity_revisions WHERE resource_type = 'product' AND resource_id = d.product_id) AS rev
       FROM product_drafts d LEFT JOIN admins ad ON ad.id = d.author_admin_id LEFT JOIN users u ON u.id = ad.user_id
      WHERE d.product_id = $1 ORDER BY d.updated_at DESC`,
    [productId]
  )
  if (!rows.length) return []
  const locks = await draftLockChips('product', rows.map(r => r.id), me)
  return rows.map(r => ({
    id: r.id,
    entityId: productId,
    title: r.title,
    authorId: r.author_admin_id,
    authorName: r.author_name,
    baseRevision: r.base_revision ?? 0,
    updatedAt: r.updated_at,
    behind: r.has_base ? Math.max(0, Number(r.rev) - (r.base_revision ?? 0)) : 0,
    lock: locks[r.id] ?? null,
  }))
}
