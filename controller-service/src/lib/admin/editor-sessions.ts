import type { PoolClient } from 'pg'
import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'

export type ResourceType =
  | 'mailer'
  | 'review_form'
  | 'product'
  | 'category'
  | 'brand'
  | 'coupon'
  | 'campaign'
  | 'supplier'
  | 'offer'
  | 'site_controls'
  | 'po_new'
  | 'po_receive'
  | 'homepage'

export const RESOURCE_TYPES: ResourceType[] = [
  'mailer',
  'review_form',
  'product',
  'category',
  'brand',
  'coupon',
  'campaign',
  'supplier',
  'offer',
  'site_controls',
  'po_new',
  'po_receive',
  'homepage',
]

/**
 * Snapshot the current editable state of a resource — called at page-load so
 * Cancel can roll back to this exact shape later. Each branch returns a jsonb
 * blob plus the resource's updated_at (for conflict detection on close).
 */
export async function snapshotResource(
  resourceType: ResourceType,
  resourceId: string
): Promise<{ snapshot: Record<string, unknown>; updatedAt: string | null } | null> {
  switch (resourceType) {
    case 'mailer': {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT template_key, title, subject, template_data, audience_type,
                audience_filter, scheduled_at, wizard_step, updated_at
         FROM email_campaigns WHERE id = $1 AND status = 'draft'`,
        [resourceId]
      )
      if (!row) return null
      return { snapshot: row, updatedAt: (row.updated_at as string) ?? null }
    }
    case 'review_form': {
      const draft = await queryOne<{ fields: unknown; updated_at: string }>(
        `SELECT fields, updated_at FROM review_form_drafts WHERE form_id = $1`,
        [resourceId]
      )
      if (draft) return { snapshot: { kind: 'edit', fields: draft.fields }, updatedAt: draft.updated_at }
      const live = await queryOne<Record<string, unknown>>(
        `SELECT slug, title, description, google_review_url, coupon_id, is_active,
                custom_fields, template_type, is_draft
         FROM review_forms WHERE id = $1`,
        [resourceId]
      )
      if (!live) return null
      return { snapshot: { kind: 'create', fields: live }, updatedAt: null }
    }
    case 'product': {
      // The whole draft: variants, sub-variants, images, units and variant images change in a session too.
      const draft = await queryOne<Record<string, unknown> & { updated_at: string }>(
        `SELECT fields, variants, sub_variants, images, units, variant_images, updated_at
           FROM product_drafts WHERE product_id = $1`,
        [resourceId]
      )
      if (draft) {
        const { updated_at, ...cols } = draft
        return { snapshot: { kind: 'edit', ...cols }, updatedAt: updated_at }
      }
      return { snapshot: { kind: 'create', fields: {} }, updatedAt: null }
    }
    case 'category':
    case 'brand':
    case 'coupon': {
      const table = DRAFT_TABLE[resourceType]
      const key = DRAFT_KEY[resourceType]
      const draft = await queryOne<{ fields: unknown; updated_at: string }>(
        `SELECT fields, updated_at FROM ${table} WHERE ${key} = $1`,
        [resourceId]
      )
      if (draft) return { snapshot: { kind: 'edit', fields: draft.fields }, updatedAt: draft.updated_at }
      return { snapshot: { kind: 'create', fields: {} }, updatedAt: null }
    }
    case 'campaign': {
      const draft = await queryOne<{ fields: unknown; updated_at: string }>(
        `SELECT fields, updated_at FROM campaign_drafts WHERE campaign_id = $1`,
        [resourceId]
      )
      if (draft) return { snapshot: { kind: 'edit', fields: draft.fields }, updatedAt: draft.updated_at }
      return { snapshot: { kind: 'none' }, updatedAt: null }
    }
    case 'supplier': {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT * FROM supplier_drafts WHERE supplier_id = $1`,
        [resourceId]
      )
      if (!row) return null
      return { snapshot: row, updatedAt: (row.updated_at as string) ?? null }
    }
    case 'offer': {
      const draft = await queryOne<{ fields: unknown; products: unknown; updated_at: string }>(
        `SELECT fields, products, updated_at FROM offer_drafts WHERE offer_id = $1`,
        [resourceId]
      )
      if (draft) {
        return {
          snapshot: { kind: 'edit', fields: draft.fields, products: draft.products },
          updatedAt: draft.updated_at,
        }
      }
      // No draft yet — Cancel means "DELETE the draft row we created during this session".
      return { snapshot: { kind: 'none' }, updatedAt: null }
    }
    case 'site_controls': {
      // resourceId here is the admin's own uuid; scope lives on the draft rows.
      // Snapshot = all open draft rows for this admin, keyed by scope.
      const rows = await queryMany<{ scope: string; fields: unknown; updated_at: string }>(
        `SELECT scope, fields, updated_at FROM site_control_drafts WHERE admin_id = $1`,
        [resourceId]
      )
      const byScope: Record<string, unknown> = {}
      for (const r of rows) byScope[r.scope] = r.fields
      return { snapshot: { kind: 'edit', byScope }, updatedAt: null }
    }
    case 'po_new': {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT supplier_id, order_date, expected_date, status, notes, line_items, updated_at
         FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`,
        [resourceId]
      )
      if (!row) return { snapshot: { kind: 'none' }, updatedAt: null }
      return { snapshot: { kind: 'edit', fields: row }, updatedAt: (row.updated_at as string) ?? null }
    }
    case 'po_receive': {
      const row = await queryOne<{ line_items: unknown; serials: unknown; updated_at: string }>(
        `SELECT line_items, serials, updated_at FROM po_receive_drafts WHERE po_id = $1`,
        [resourceId]
      )
      if (!row) return { snapshot: { kind: 'none' }, updatedAt: null }
      return {
        snapshot: { kind: 'edit', line_items: row.line_items, serials: row.serials },
        updatedAt: row.updated_at,
      }
    }
    case 'homepage': {
      // Singleton draft (homepage_drafts.id = true). resourceId is the admin's own uuid.
      const row = await queryOne<{ sections: unknown; hero_slides: unknown; updated_at: string }>(
        `SELECT sections, hero_slides, updated_at FROM homepage_drafts WHERE id = true`
      )
      if (!row) return { snapshot: { kind: 'none' }, updatedAt: null }
      return {
        snapshot: { kind: 'edit', sections: row.sections, hero_slides: row.hero_slides },
        updatedAt: row.updated_at,
      }
    }
  }
}

const DRAFT_TABLE: Record<string, string> = {
  product: 'product_drafts',
  category: 'category_drafts',
  brand: 'brand_drafts',
  coupon: 'coupon_drafts',
}

const DRAFT_KEY: Record<string, string> = {
  product: 'product_id',
  category: 'category_id',
  brand: 'brand_id',
  coupon: 'coupon_id',
}

/**
 * Restore a resource to its snapshotted state inside a transaction. The caller
 * wraps this with the session's closed_at bookkeeping.
 */
export async function restoreSnapshot(
  client: PoolClient,
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>
): Promise<void> {
  switch (resourceType) {
    case 'mailer': {
      await client.query(
        `UPDATE email_campaigns SET
          template_key    = $1,
          title           = $2,
          subject         = $3,
          template_data   = $4,
          audience_type   = $5,
          audience_filter = $6,
          scheduled_at    = $7,
          wizard_step     = $8,
          updated_at      = now()
         WHERE id = $9 AND status = 'draft'`,
        [
          snapshot.template_key,
          snapshot.title,
          snapshot.subject,
          JSON.stringify(snapshot.template_data ?? {}),
          snapshot.audience_type,
          JSON.stringify(snapshot.audience_filter ?? {}),
          snapshot.scheduled_at ?? null,
          snapshot.wizard_step ?? 1,
          resourceId,
        ]
      )
      return
    }
    case 'review_form': {
      const kind = (snapshot as { kind?: string }).kind
      const fields = (snapshot as { fields: Record<string, unknown> }).fields
      if (kind === 'edit') {
        await client.query(
          `UPDATE review_form_drafts SET fields = $1::jsonb, updated_at = now() WHERE form_id = $2`,
          [JSON.stringify(fields), resourceId]
        )
      } else {
        await client.query(
          `UPDATE review_forms SET
            slug = $1, title = $2, description = $3, google_review_url = $4,
            coupon_id = $5, is_active = $6, custom_fields = $7::jsonb,
            template_type = $8, is_draft = $9
           WHERE id = $10`,
          [
            fields.slug,
            fields.title,
            fields.description,
            fields.google_review_url,
            fields.coupon_id,
            fields.is_active,
            JSON.stringify(fields.custom_fields ?? []),
            fields.template_type,
            fields.is_draft,
            resourceId,
          ]
        )
      }
      return
    }
    case 'product': {
      if ((snapshot as { kind?: string }).kind !== 'edit') {
        await client.query(`DELETE FROM product_drafts WHERE product_id = $1`, [resourceId])
        return
      }
      // Older snapshots carry only fields; restore whichever columns were captured.
      const cols = ['fields', 'variants', 'sub_variants', 'images', 'units', 'variant_images'].filter(
        c => (snapshot as Record<string, unknown>)[c] !== undefined
      )
      if (cols.length === 0) return
      await client.query(
        `UPDATE product_drafts SET ${cols.map((c, i) => `${c} = $${i + 1}::jsonb`).join(', ')}, updated_at = now()
          WHERE product_id = $${cols.length + 1}`,
        [...cols.map(c => JSON.stringify((snapshot as Record<string, unknown>)[c])), resourceId]
      )
      return
    }
    case 'category':
    case 'brand':
    case 'coupon': {
      const table = DRAFT_TABLE[resourceType]
      const key = DRAFT_KEY[resourceType]
      const kind = (snapshot as { kind?: string }).kind
      const fields = (snapshot as { fields: Record<string, unknown> }).fields
      if (kind === 'edit') {
        await client.query(
          `UPDATE ${table} SET fields = $1::jsonb, updated_at = now() WHERE ${key} = $2`,
          [JSON.stringify(fields), resourceId]
        )
      } else {
        await client.query(`DELETE FROM ${table} WHERE ${key} = $1`, [resourceId])
      }
      return
    }
    case 'campaign': {
      const kind = (snapshot as { kind?: string }).kind
      if (kind === 'edit') {
        const fields = (snapshot as { fields: Record<string, unknown> }).fields
        await client.query(
          `UPDATE campaign_drafts SET fields = $1::jsonb, updated_at = now() WHERE campaign_id = $2`,
          [JSON.stringify(fields), resourceId]
        )
      } else {
        await client.query(`DELETE FROM campaign_drafts WHERE campaign_id = $1`, [resourceId])
      }
      return
    }
    case 'supplier': {
      // supplier_drafts has heterogeneous columns; restore by DELETE+INSERT of the snapshot row.
      const cols = Object.keys(snapshot).filter(c => c !== 'updated_at')
      const vals = cols.map(c => (snapshot as Record<string, unknown>)[c])
      await client.query(`DELETE FROM supplier_drafts WHERE supplier_id = $1`, [resourceId])
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
      await client.query(
        `INSERT INTO supplier_drafts (${cols.join(', ')}) VALUES (${placeholders})`,
        vals
      )
      return
    }
    case 'offer': {
      const kind = (snapshot as { kind?: string }).kind
      if (kind === 'edit') {
        const fields = (snapshot as { fields: unknown }).fields
        const products = (snapshot as { products: unknown }).products
        await client.query(
          `UPDATE offer_drafts SET fields = $1::jsonb, products = $2::jsonb, updated_at = now()
           WHERE offer_id = $3`,
          [JSON.stringify(fields), JSON.stringify(products), resourceId]
        )
      } else {
        await client.query(`DELETE FROM offer_drafts WHERE offer_id = $1`, [resourceId])
      }
      return
    }
    case 'site_controls': {
      const byScope = (snapshot as { byScope?: Record<string, unknown> }).byScope ?? {}
      // Wipe this admin's drafts and reinsert the snapshot — safe because
      // the snapshot captured ALL open draft scopes at session start.
      await client.query(`DELETE FROM site_control_drafts WHERE admin_id = $1`, [resourceId])
      for (const scope of Object.keys(byScope)) {
        await client.query(
          `INSERT INTO site_control_drafts (admin_id, scope, fields, updated_at)
           VALUES ($1, $2, $3::jsonb, now())`,
          [resourceId, scope, JSON.stringify(byScope[scope])]
        )
      }
      return
    }
    case 'po_new': {
      const kind = (snapshot as { kind?: string }).kind
      if (kind === 'edit') {
        const f = (snapshot as { fields: Record<string, unknown> }).fields
        await client.query(
          `UPDATE po_drafts SET
             supplier_id = $1, order_date = $2, expected_date = $3,
             status = $4, notes = $5, line_items = $6::jsonb, updated_at = now()
           WHERE id = $7 AND promoted_po_id IS NULL`,
          [
            f.supplier_id ?? null,
            f.order_date ?? null,
            f.expected_date ?? null,
            f.status ?? null,
            f.notes ?? null,
            JSON.stringify(f.line_items ?? []),
            resourceId,
          ]
        )
      } else {
        await client.query(
          `DELETE FROM po_drafts WHERE id = $1 AND promoted_po_id IS NULL`,
          [resourceId]
        )
      }
      return
    }
    case 'po_receive': {
      const kind = (snapshot as { kind?: string }).kind
      if (kind === 'edit') {
        const lineItems = (snapshot as { line_items: unknown }).line_items
        const serials = (snapshot as { serials: unknown }).serials
        await client.query(
          `UPDATE po_receive_drafts
           SET line_items = $1::jsonb, serials = $2::jsonb, updated_at = now()
           WHERE po_id = $3`,
          [JSON.stringify(lineItems ?? []), JSON.stringify(serials ?? []), resourceId]
        )
      } else {
        await client.query(`DELETE FROM po_receive_drafts WHERE po_id = $1`, [resourceId])
      }
      return
    }
    case 'homepage': {
      // Singleton: upsert the draft row back to the snapshot shape, or delete it if there was none.
      const kind = (snapshot as { kind?: string }).kind
      if (kind === 'edit') {
        const sections = (snapshot as { sections: unknown }).sections
        const heroSlides = (snapshot as { hero_slides: unknown }).hero_slides
        await client.query(
          `INSERT INTO homepage_drafts (id, sections, hero_slides, updated_by, updated_at)
             VALUES (true, $1::jsonb, $2::jsonb, $3::uuid, now())
           ON CONFLICT (id) DO UPDATE
             SET sections = EXCLUDED.sections,
                 hero_slides = EXCLUDED.hero_slides,
                 updated_by = EXCLUDED.updated_by,
                 updated_at = now()`,
          [JSON.stringify(sections ?? []), JSON.stringify(heroSlides ?? []), resourceId]
        )
      } else {
        await client.query(`DELETE FROM homepage_drafts WHERE id = true`)
      }
      return
    }
  }
}

/** Open an edit session or return the existing open one for this admin+resource. */
export async function openSession(
  adminId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<{ id: string; resumed: boolean; startedAt: string; changeCount: number } | null> {
  const existing = await queryOne<{ id: string; started_at: string; change_count: number }>(
    `SELECT id, started_at, change_count FROM editor_sessions
     WHERE admin_id = $1 AND resource_type = $2 AND resource_id = $3 AND closed_at IS NULL
     LIMIT 1`,
    [adminId, resourceType, resourceId]
  )
  if (existing) {
    return {
      id: existing.id,
      resumed: true,
      startedAt: existing.started_at,
      changeCount: existing.change_count,
    }
  }
  const snap = await snapshotResource(resourceType, resourceId)
  if (!snap) return null
  const row = await queryOne<{ id: string; started_at: string }>(
    `INSERT INTO editor_sessions (admin_id, resource_type, resource_id, snapshot)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id, started_at`,
    [adminId, resourceType, resourceId, JSON.stringify(snap.snapshot)]
  )
  return row ? { id: row.id, resumed: false, startedAt: row.started_at, changeCount: 0 } : null
}

/**
 * Resnapshot an open session to the current draft shape. Idempotent.
 * Called after a Save-as-Draft so a later Cancel reverts to the just-saved draft
 * (A2) and not to the pre-session snapshot (A1). Leaves open/close/restore alone.
 */
export async function resnapshotSession(sessionId: string, adminId: string): Promise<boolean> {
  const session = await queryOne<{ resource_type: ResourceType; resource_id: string }>(
    `SELECT resource_type, resource_id FROM editor_sessions
     WHERE id = $1 AND admin_id = $2 AND closed_at IS NULL`,
    [sessionId, adminId]
  )
  if (!session) return false
  const snap = await snapshotResource(session.resource_type, session.resource_id)
  if (!snap) return false
  const r = await query(
    `UPDATE editor_sessions SET snapshot = $1::jsonb
     WHERE id = $2 AND admin_id = $3 AND closed_at IS NULL`,
    [JSON.stringify(snap.snapshot), sessionId, adminId]
  )
  return (r.rowCount ?? 0) > 0
}

/** Mark the session saved — autosave already carried the final state to the draft. */
export async function saveSession(sessionId: string, adminId: string): Promise<boolean> {
  const r = await query(
    `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'save'
     WHERE id = $1 AND admin_id = $2 AND closed_at IS NULL`,
    [sessionId, adminId]
  )
  return (r.rowCount ?? 0) > 0
}

/** Roll back the resource to the session's snapshot inside a transaction. */
export async function cancelSession(sessionId: string, adminId: string): Promise<boolean> {
  const session = await queryOne<{
    resource_type: ResourceType
    resource_id: string
    snapshot: Record<string, unknown>
  }>(
    `SELECT resource_type, resource_id, snapshot FROM editor_sessions
     WHERE id = $1 AND admin_id = $2 AND closed_at IS NULL`,
    [sessionId, adminId]
  )
  if (!session) return false
  await withTransaction(async (client: PoolClient) => {
    await restoreSnapshot(client, session.resource_type, session.resource_id, session.snapshot)
    await client.query(
      `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'cancel' WHERE id = $1`,
      [sessionId]
    )
  })
  return true
}

/** Called by the /draft POST handlers to tick the change counter. */
export async function bumpChangeCount(sessionId: string, adminId: string): Promise<void> {
  await query(
    `UPDATE editor_sessions SET change_count = change_count + 1
     WHERE id = $1 AND admin_id = $2 AND closed_at IS NULL`,
    [sessionId, adminId]
  )
}

/**
 * Look up the open edit session for a given admin + resource, if any.
 * Write endpoints use this to decide: write to draft (session open) vs live (no session).
 */
export async function findOpenSession(
  adminId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<{ id: string } | null> {
  return queryOne<{ id: string }>(
    `SELECT id FROM editor_sessions
     WHERE admin_id = $1 AND resource_type = $2 AND resource_id = $3 AND closed_at IS NULL
     LIMIT 1`,
    [adminId, resourceType, resourceId]
  )
}
