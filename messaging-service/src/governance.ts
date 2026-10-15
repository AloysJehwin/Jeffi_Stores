import type pg from 'pg'
import { db } from './db.js'
import { PLATFORM_TENANT_ID } from './templates-v2.js'

// Jeffi's per-customer control of Messaging API (space 'api') templates: which standard templates the
// customer gets, whether they may edit, and whether their changes need review before they are sent.
// Admin calls (internal service tokens) are never restricted and their saves count as approved.

export interface MessagingSettings {
  standard_templates: 'all' | 'selected'
  allowed: Array<{ channel: string; slug: string }>
  editing_enabled: boolean
  review_required: boolean
}
const DEFAULTS: MessagingSettings = { standard_templates: 'all', allowed: [], editing_enabled: true, review_required: false }

export async function getSettings(tenantId: string): Promise<MessagingSettings> {
  if (tenantId === PLATFORM_TENANT_ID) return DEFAULTS
  const r = await db.query(`SELECT standard_templates, allowed, editing_enabled, review_required FROM messaging_tenant_settings WHERE tenant_id=$1`, [tenantId])
    .catch(() => ({ rows: [] as any[] }))
  return r.rows[0] ?? DEFAULTS
}

export async function putSettings(tenantId: string, s: Partial<MessagingSettings>, by: string | null) {
  const cur = await getSettings(tenantId)
  const next = { ...cur, ...s }
  await db.query(
    `INSERT INTO messaging_tenant_settings (tenant_id, standard_templates, allowed, editing_enabled, review_required, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET standard_templates=$2, allowed=$3, editing_enabled=$4, review_required=$5, updated_by=$6, updated_at=now()`,
    [tenantId, next.standard_templates, JSON.stringify(next.allowed), next.editing_enabled, next.review_required, by])
  return getSettings(tenantId)
}

export const standardAllowed = (s: MessagingSettings, channel: string, slug: string) =>
  s.standard_templates === 'all' || s.allowed.some(a => a.channel === channel && a.slug === slug)

const forbidden = (code: string, message: string, status = 403) => Object.assign(new Error(message), { status, code })

/** Throws unless this (non-admin) caller may change templates. */
export function assertCanEdit(s: MessagingSettings, internal: boolean) {
  if (!internal && !s.editing_enabled) throw forbidden('template_editing_disabled', 'Templates are managed by Jeffi for this workspace — contact support@jeffistores.in to change one.')
}

/** After a save/publish: admin or no-review → approved; otherwise the new version waits for review. */
export async function markReview(pool: pg.Pool, variantId: string, approve: boolean, by: string | null) {
  await pool.query(
    approve
      ? `UPDATE template_variant SET review_status='approved', approved_version_id=current_version_id, review_note=NULL, reviewed_at=now(), reviewed_by=$2 WHERE id=$1`
      : `UPDATE template_variant SET review_status='pending', review_note=NULL WHERE id=$1 AND (review_status <> 'pending' OR approved_version_id IS DISTINCT FROM current_version_id)`,
    approve ? [variantId, by] : [variantId])
}

export async function reviewDecision(pool: pg.Pool, tenantId: string, templateId: string, decision: 'approved' | 'rejected', note: string | null, by: string | null) {
  const r = await pool.query(
    decision === 'approved'
      ? `UPDATE template_variant v SET review_status='approved', approved_version_id=v.current_version_id, review_note=$3, reviewed_at=now(), reviewed_by=$4
          FROM template t WHERE t.id=$1 AND t.tenant_id=$2 AND v.template_id=t.id AND v.review_status='pending'`
      : `UPDATE template_variant v SET review_status='rejected', review_note=$3, reviewed_at=now(), reviewed_by=$4
          FROM template t WHERE t.id=$1 AND t.tenant_id=$2 AND v.template_id=t.id AND v.review_status='pending'`,
    [templateId, tenantId, note, by])
  return (r.rowCount ?? 0) > 0
}

/** Pending (and rejected) customer templates in the api space, with the live and proposed versions. */
export async function reviewQueue(pool: pg.Pool, tenantId: string) {
  const r = await pool.query(
    `SELECT t.id, t.channel, f.slug, f.name, v.review_status, v.review_note, v.updated_at,
            cur.version AS proposed_version, cur.subject AS proposed_subject, cur.body AS proposed_body, cur.blocks AS proposed_blocks, cur.blocks_format, cur.layout,
            ap.version AS live_version, ap.subject AS live_subject, ap.body AS live_body
       FROM template t
       JOIN template_family f ON f.id=t.family_id AND f.space='api'
       JOIN template_variant v ON v.id=t.current_variant_id
       LEFT JOIN template_version cur ON cur.id=v.current_version_id
       LEFT JOIN template_version ap ON ap.id=v.approved_version_id
      WHERE t.tenant_id=$1 AND t.status <> 'archived' AND v.review_status IN ('pending','rejected')
      ORDER BY v.review_status, v.updated_at DESC`, [tenantId])
  return r.rows
}
