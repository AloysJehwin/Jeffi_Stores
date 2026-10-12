import { db, q, one } from './db.js'
import { tokenKeys } from './render.js'

export interface TemplateRow {
  id: string
  tenant_id: string | null
  slug: string
  channel: string
  name: string
  subject: string | null
  body: string
  variables: string[]
  provider_ref: string | null
  status: string
  created_at: string
}

export const toApi = (t: TemplateRow) => ({
  id: t.id,
  slug: t.slug,
  channel: t.channel,
  name: t.name,
  subject: t.subject,
  body: t.body,
  variables: t.variables,
  provider_ref: t.provider_ref,
  system: t.tenant_id === null,
  status: t.status,
  created_at: new Date(t.created_at).toISOString(),
})

/** Tenant template wins over a system template with the same slug+channel. */
export function findTemplate(tenantId: string, channel: string, slug: string) {
  return one<TemplateRow>(
    `SELECT * FROM message_templates
      WHERE channel=$2 AND slug=$3 AND status='active' AND (tenant_id=$1 OR tenant_id IS NULL)
      ORDER BY tenant_id NULLS LAST LIMIT 1`,
    [tenantId, channel, slug]
  )
}

export function listTemplates(tenantId: string, channel?: string, includeSystem = true) {
  return q<TemplateRow>(
    `SELECT * FROM message_templates
      WHERE status='active' AND (tenant_id=$1 OR ($2 AND tenant_id IS NULL)) AND ($3::text IS NULL OR channel=$3)
      ORDER BY tenant_id NULLS LAST, slug`,
    [tenantId, includeSystem, channel ?? null]
  )
}

export function upsertTemplate(
  tenantId: string,
  t: { slug: string; channel: string; name: string; subject?: string; body: string; provider_ref?: string }
) {
  if (t.slug.startsWith('system/')) throw Object.assign(new Error('system/ prefix is reserved'), { status: 400 })
  const variables = [...new Set([...tokenKeys(t.subject ?? ''), ...tokenKeys(t.body)])]
  return one<TemplateRow>(
    `INSERT INTO message_templates (tenant_id, slug, channel, name, subject, body, variables, provider_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid), channel, slug)
     DO UPDATE SET name=EXCLUDED.name, subject=EXCLUDED.subject, body=EXCLUDED.body, variables=EXCLUDED.variables,
                   provider_ref=EXCLUDED.provider_ref, status='active', updated_at=now()
     RETURNING *`,
    [tenantId, t.slug, t.channel, t.name, t.subject ?? null, t.body, variables, t.provider_ref ?? null]
  )
}

export async function archiveTemplate(tenantId: string, channel: string, slug: string) {
  const r = await db.query(
    `UPDATE message_templates SET status='archived', updated_at=now() WHERE tenant_id=$1 AND channel=$2 AND slug=$3`,
    [tenantId, channel, slug]
  )
  return r.rowCount ?? 0
}
