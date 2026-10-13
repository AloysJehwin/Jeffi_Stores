import type pg from 'pg'
import { tokenKeys } from './render.js'

// Three-level model: template_family → template → template_variant → template_version.
// Pool is injected by the caller (control-plane pool today, per-tenant pool tomorrow — see
// packages/tenancy/pools.ts tenantPool()). tenant_id scopes rows until each tenant moves to its own DB.
//
// Platform defaults + tenant overrides: rows under PLATFORM_TENANT_ID live in the flagship
// (control-plane) DB and are visible to every tenant as read-only defaults. Tenant rows live in
// the tenant's own DB. Reads merge the two pools (tenant row shadows the platform row with the same
// slug+channel); writes always go to the tenant pool. See listTemplatesWithDefaults/findBySlugWithDefaults.

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

type Executor = pg.Pool | pg.PoolClient
export type Pools = { tenant: Executor; platform: Executor }
const rows = async <T extends pg.QueryResultRow = any>(e: Executor, text: string, params?: unknown[]) =>
  (await e.query<T>(text, params)).rows
const first = async <T extends pg.QueryResultRow = any>(e: Executor, text: string, params?: unknown[]) =>
  (await e.query<T>(text, params)).rows[0] as T | undefined

export interface FamilyRow {
  id: string; tenant_id: string; slug: string; name: string
  category: string | null; description: string | null; tags: string[]
  created_by: string | null; created_at: string; updated_at: string
}
export interface TemplateRow {
  id: string; family_id: string; tenant_id: string; channel: string
  current_variant_id: string | null; status: string
  created_at: string; updated_at: string
}
export interface VariantRow {
  id: string; template_id: string; tenant_id: string; locale: string
  current_version_id: string | null; provider_ref: string | null
  meta_category: string | null; media_type: string | null
  approval_status: string; approval_raw_status: string | null
  approval_reason: string | null; approval_submitted_at: string | null
  approval_approved_at: string | null; approval_checked_at: string | null
  created_at: string; updated_at: string
}
export interface VersionRow {
  id: string; variant_id: string; version: number
  subject: string | null; body: string; blocks: any; blocks_format: string | null
  variables: string[]; provider_ref: string | null; note: string | null; layout: 'store' | 'none'
  created_by: string | null; created_at: string
}
export interface FullTemplate {
  family: FamilyRow; template: TemplateRow; variant: VariantRow; version: VersionRow | null
}

// A tenant can run a store and the Messaging API; each keeps its own template copies ('space').
export type Space = 'store' | 'api'

export const listFamilies = (e: Executor, tenantId: string, channel?: string, category?: string, space: Space = 'store') =>
  rows(e,
    `SELECT f.*, COALESCE(array_agg(t.channel ORDER BY t.channel) FILTER (WHERE t.id IS NOT NULL), '{}') AS channels
       FROM template_family f
       LEFT JOIN template t ON t.family_id=f.id AND ($2::text IS NULL OR t.channel=$2)
      WHERE f.tenant_id=$1 AND f.space=$4 AND ($3::text IS NULL OR f.category=$3)
      GROUP BY f.id
      ORDER BY f.name`,
    [tenantId, channel ?? null, category ?? null, space])

export const listTemplates = (e: Executor, tenantId: string, channel?: string, space: Space = 'store') =>
  rows(e,
    `SELECT t.id, t.family_id, t.channel, t.status, t.current_variant_id, t.tenant_id,
            f.slug, f.name, f.category,
            v.id AS variant_id, v.locale, v.provider_ref, v.approval_status,
            ver.version AS current_version, ver.subject
       FROM template t
       JOIN template_family f ON f.id=t.family_id
       LEFT JOIN template_variant v ON v.id=t.current_variant_id
       LEFT JOIN template_version ver ON ver.id=v.current_version_id
      WHERE t.tenant_id=$1 AND f.space=$3 AND t.status <> 'archived' AND ($2::text IS NULL OR t.channel=$2)
      ORDER BY f.name, t.channel`,
    [tenantId, channel ?? null, space])

// Tenant rows (tenant pool) + platform defaults (flagship pool); tenant shadows same slug+channel.
// A tenant DB that lacks the template tables yet (42P01) just yields no overrides.
const noTable = (e: any) => e?.code === '42P01'
export async function listTemplatesWithDefaults(p: Pools, tenantId: string, channel?: string, space: Space = 'store') {
  const own = await listTemplates(p.tenant, tenantId, channel, space).catch(e => { if (noTable(e)) return []; throw e })
  if (tenantId === PLATFORM_TENANT_ID) return own.map(r => ({ ...r, source: 'platform' }))
  const defaults = await listTemplates(p.platform, PLATFORM_TENANT_ID, channel)
  const key = (r: any) => `${r.slug}|${r.channel}`
  const seen = new Set(own.map(key))
  return [
    ...own.map(r => ({ ...r, source: 'tenant' })),
    ...defaults.filter(r => !seen.has(key(r))).map(r => ({ ...r, source: 'platform' })),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.channel.localeCompare(b.channel))
}

// Tenant copy first; else the platform default (flagship pool) with the same slug.
export async function findBySlugWithDefaults(p: Pools, tenantId: string, channel: string, slug: string, locale = 'en', space: Space = 'store'): Promise<FullTemplate | null> {
  const own = await findBySlug(p.tenant, tenantId, channel, slug, locale, space).catch(e => { if (noTable(e)) return null; throw e })
  if (own || tenantId === PLATFORM_TENANT_ID) return own
  return findBySlug(p.platform, PLATFORM_TENANT_ID, channel, slug, locale)
}

/** Body/subject of the version Meta approved (the one the live provider_ref points at). */
export const liveVersion = (e: Executor, variantId: string, providerRef: string) =>
  first<VersionRow>(e, `SELECT * FROM template_version WHERE variant_id=$1 AND provider_ref=$2 ORDER BY version DESC LIMIT 1`, [variantId, providerRef])

export async function findBySlug(e: Executor, tenantId: string, channel: string, slug: string, locale = 'en', space: Space = 'store'): Promise<FullTemplate | null> {
  const family = await first<FamilyRow>(e, `SELECT * FROM template_family WHERE tenant_id=$1 AND slug=$2 AND space=$3`, [tenantId, slug, space])
  if (!family) return null
  const template = await first<TemplateRow>(e, `SELECT * FROM template WHERE family_id=$1 AND channel=$2 AND status <> 'archived'`, [family.id, channel])
  if (!template) return null
  let variant = await first<VariantRow>(e, `SELECT * FROM template_variant WHERE template_id=$1 AND locale=$2`, [template.id, locale])
  if (!variant && template.current_variant_id)
    variant = await first<VariantRow>(e, `SELECT * FROM template_variant WHERE id=$1`, [template.current_variant_id])
  if (!variant) return null
  const version = variant.current_version_id
    ? (await first<VersionRow>(e, `SELECT * FROM template_version WHERE id=$1`, [variant.current_version_id])) ?? null
    : null
  return { family, template, variant, version }
}

export async function findById(e: Executor, tenantId: string, templateId: string, space: Space = 'store'): Promise<FullTemplate | null> {
  const template = await first<TemplateRow>(e, `SELECT * FROM template WHERE id=$1 AND tenant_id=$2`, [templateId, tenantId])
  if (!template) return null
  const family = await first<FamilyRow>(e, `SELECT * FROM template_family WHERE id=$1 AND space=$2`, [template.family_id, space])
  if (!family) return null
  const variant = template.current_variant_id
    ? await first<VariantRow>(e, `SELECT * FROM template_variant WHERE id=$1`, [template.current_variant_id])
    : await first<VariantRow>(e, `SELECT * FROM template_variant WHERE template_id=$1 ORDER BY created_at LIMIT 1`, [template.id])
  if (!variant) return { family, template, variant: null as any, version: null }
  const version = variant.current_version_id
    ? (await first<VersionRow>(e, `SELECT * FROM template_version WHERE id=$1`, [variant.current_version_id])) ?? null
    : null
  return { family, template, variant, version }
}

export const listVersions = (e: Executor, variantId: string) =>
  rows<VersionRow>(e, `SELECT * FROM template_version WHERE variant_id=$1 ORDER BY version DESC`, [variantId])

export interface UpsertInput {
  slug: string
  channel: 'email' | 'sms' | 'whatsapp'
  name: string
  category?: string
  description?: string
  locale?: string
  subject?: string
  body: string
  blocks?: any
  blocks_format?: 'tiptap' | 'tiptap-html' | 'email-blocks' | 'maily' | 'mjml' | 'wa-content' | 'sms-text'
  meta_category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  media_type?: 'image' | 'video' | 'document'
  provider_ref?: string
  note?: string
  createdBy?: string
  publish?: boolean
  /** Email: 'store' wraps the body in the store's email layout; 'none' sends the HTML as written. */
  layout?: 'store' | 'none'
}

export async function upsertTemplate(pool: pg.Pool, tenantId: string, i: UpsertInput, space: Space = 'store'): Promise<FullTemplate> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const family = (await c.query<FamilyRow>(
      `INSERT INTO template_family (tenant_id, slug, name, category, description, space)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, space, slug) DO UPDATE SET name=EXCLUDED.name,
         category=COALESCE(EXCLUDED.category, template_family.category),
         description=COALESCE(EXCLUDED.description, template_family.description),
         updated_at=now()
       RETURNING *`,
      [tenantId, i.slug, i.name, i.category ?? null, i.description ?? null, space])).rows[0]

    const template = (await c.query<TemplateRow>(
      `INSERT INTO template (family_id, tenant_id, channel, status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (family_id, channel) DO UPDATE SET status='active', updated_at=now()
       RETURNING *`,
      [family.id, tenantId, i.channel])).rows[0]

    const locale = i.locale ?? 'en'
    // Media-type immutability: once a variant is approved, Meta locks the header
    // media type (image|video|document). We allow URL swaps of the same type but
    // reject a type change outright.
    const existingVariant = await first<VariantRow>(c,
      `SELECT * FROM template_variant WHERE template_id=$1 AND locale=$2`, [template.id, locale])
    if (existingVariant && existingVariant.approval_status === 'approved'
        && i.media_type && existingVariant.media_type && existingVariant.media_type !== i.media_type) {
      throw Object.assign(new Error(
        `media_type is immutable after approval (locked to '${existingVariant.media_type}', got '${i.media_type}')`),
        { status: 409, code: 'media_type_locked' })
    }
    const variant = (await c.query<VariantRow>(
      `INSERT INTO template_variant (template_id, tenant_id, locale, provider_ref, meta_category, media_type)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (template_id, locale) DO UPDATE SET
         provider_ref=COALESCE(EXCLUDED.provider_ref, template_variant.provider_ref),
         meta_category=COALESCE(EXCLUDED.meta_category, template_variant.meta_category),
         media_type=COALESCE(EXCLUDED.media_type, template_variant.media_type),
         updated_at=now()
       RETURNING *`,
      [template.id, tenantId, locale, i.provider_ref ?? null, i.meta_category ?? null, i.media_type ?? null])).rows[0]

    const maxV = (await c.query<{ max: number }>(
      `SELECT COALESCE(MAX(version),0) AS max FROM template_version WHERE variant_id=$1`,
      [variant.id])).rows[0].max
    const version = (maxV ?? 0) + 1
    const variables = [...new Set([
      ...tokenKeys(i.subject ?? ''),
      ...tokenKeys(i.body),
      ...tokenKeys(JSON.stringify(i.blocks ?? {})),
    ])]
    const ver = (await c.query<VersionRow>(
      `INSERT INTO template_version
         (variant_id, version, subject, body, blocks, blocks_format, variables, provider_ref, note, created_by, layout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         -- Not given → keep the current version's layout.
         COALESCE($11, (SELECT layout FROM template_version WHERE id=$12), 'store'))
       RETURNING *`,
      // JSON-encode: a raw HTML string (or an array) is not valid jsonb input as-is.
      [variant.id, version, i.subject ?? null, i.body, i.blocks == null ? null : JSON.stringify(i.blocks),
       i.blocks_format ?? defaultBlocksFormat(i.channel), variables, i.provider_ref ?? null,
       i.note ?? null, i.createdBy ?? null, i.layout ?? null, variant.current_version_id ?? null])).rows[0]

    if (i.publish !== false) {
      await c.query(`UPDATE template_variant SET current_version_id=$2, updated_at=now() WHERE id=$1`, [variant.id, ver.id])
      variant.current_version_id = ver.id
      if (!template.current_variant_id) {
        await c.query(`UPDATE template SET current_variant_id=$2, status='active', updated_at=now() WHERE id=$1`, [template.id, variant.id])
        template.current_variant_id = variant.id
      }
    }
    await c.query('COMMIT')
    return { family, template, variant, version: ver }
  } catch (e) {
    await c.query('ROLLBACK'); throw e
  } finally {
    c.release()
  }
}

export async function publishVersion(e: Executor, tenantId: string, variantId: string, versionId: string, space: Space = 'store') {
  const r = await e.query(
    `UPDATE template_variant SET current_version_id=$2, updated_at=now()
      WHERE id=$1 AND tenant_id=$3
        AND EXISTS (SELECT 1 FROM template_version WHERE id=$2 AND variant_id=$1)
        AND EXISTS (SELECT 1 FROM template t JOIN template_family f ON f.id=t.family_id WHERE t.id=template_variant.template_id AND f.space=$4)`,
    [variantId, versionId, tenantId, space])
  return (r.rowCount ?? 0) > 0
}

export async function archiveTemplate(e: Executor, tenantId: string, templateId: string, space: Space = 'store') {
  const r = await e.query(
    `UPDATE template SET status='archived', updated_at=now() WHERE id=$1 AND tenant_id=$2
        AND EXISTS (SELECT 1 FROM template_family f WHERE f.id=template.family_id AND f.space=$3)`,
    [templateId, tenantId, space])
  return (r.rowCount ?? 0) > 0
}

export async function setApprovalStatus(e: Executor, variantId: string, patch: {
  status: string; raw?: string | null; reason?: string | null; submittedAt?: Date | null; approvedAt?: Date | null
}) {
  await e.query(
    `UPDATE template_variant SET
       approval_status=$2,
       approval_raw_status=COALESCE($3, approval_raw_status),
       approval_reason=COALESCE($4, approval_reason),
       approval_submitted_at=COALESCE($5, approval_submitted_at),
       approval_approved_at=COALESCE($6, approval_approved_at),
       approval_checked_at=now(),
       updated_at=now()
     WHERE id=$1`,
    [variantId, patch.status, patch.raw ?? null, patch.reason ?? null, patch.submittedAt ?? null, patch.approvedAt ?? null])
}

function defaultBlocksFormat(channel: 'email' | 'sms' | 'whatsapp') {
  return channel === 'email' ? 'maily' : channel === 'whatsapp' ? 'wa-content' : 'sms-text'
}

export const toApi = (t: FullTemplate) => ({
  id: t.template.id,
  family_id: t.family.id,
  slug: t.family.slug,
  name: t.family.name,
  category: t.family.category,
  description: t.family.description,
  channel: t.template.channel,
  status: t.template.status,
  locale: t.variant?.locale,
  provider_ref: t.variant?.provider_ref,
  approval_status: t.variant?.approval_status,
  approval_reason: t.variant?.approval_reason,
  // Saved edit not yet submitted: customers keep receiving the approved (live) version.
  needs_resubmission: t.template.channel === 'whatsapp' && !!t.variant?.provider_ref && !!t.version && !t.version.provider_ref,
  meta_category: t.variant?.meta_category,
  media_type: t.variant?.media_type,
  current_version: t.version ? {
    id: t.version.id,
    version: t.version.version,
    subject: t.version.subject,
    body: t.version.body,
    blocks: t.version.blocks,
    blocks_format: t.version.blocks_format,
    variables: t.version.variables,
    layout: t.version.layout ?? 'store',
    created_at: new Date(t.version.created_at).toISOString(),
  } : null,
})
