import { z } from 'zod'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { PLATFORMS } from './posts'
import type { SocialPlatform } from '@/lib/tenant-registry'

// Caption templates and auto-post rules, scoped to the caller's store.

const scoped = (tenantId: string | null, idx: number) => (tenantId ? { sql: `tenant_id = $${idx}`, args: [tenantId] } : { sql: 'tenant_id IS NULL', args: [] })

export const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.string().trim().max(2000).nullish(),
})

export async function saveTemplate(tenantId: string | null, t: z.infer<typeof TemplateSchema>, id?: string) {
  const pool = controlPlanePool()
  if (id) {
    const s = scoped(tenantId, 5)
    const r = await pool.query(`UPDATE social_templates SET name = $2, caption = $3, hashtags = $4 WHERE id = $1 AND ${s.sql} RETURNING *`, [id, t.name, t.caption, t.hashtags ?? null, ...s.args])
    return r.rows[0] ?? null
  }
  const r = await pool.query(`INSERT INTO social_templates (tenant_id, name, caption, hashtags) VALUES ($1,$2,$3,$4) RETURNING *`, [tenantId, t.name, t.caption, t.hashtags ?? null])
  return r.rows[0]
}

export async function deleteTemplate(tenantId: string | null, id: string): Promise<boolean> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(`DELETE FROM social_templates WHERE id = $1 AND ${s.sql}`, [id, ...s.args])
  return (r.rowCount ?? 0) > 0
}

export const RuleSchema = z.object({
  trigger: z.enum(['new_product', 'back_in_stock', 'price_drop']),
  // Videos are not generated, so reels and YouTube are not offered for automatic posts.
  platforms: z.array(z.enum(PLATFORMS.filter(p => p !== 'ig_reel' && p !== 'youtube') as [SocialPlatform, ...SocialPlatform[]])).min(1),
  templateId: z.string().uuid().nullish(),
  minDropPct: z.number().min(1).max(90).default(10),
  requireApproval: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

export async function saveRule(tenantId: string | null, r: z.infer<typeof RuleSchema>, id?: string) {
  const pool = controlPlanePool()
  const vals = [r.trigger, [...new Set(r.platforms)], r.templateId ?? null, r.minDropPct, r.requireApproval, r.enabled]
  if (id) {
    const s = scoped(tenantId, 8)
    const q = await pool.query(
      `UPDATE social_autopost_rules SET trigger = $2, platforms = $3, template_id = $4, min_drop_pct = $5, require_approval = $6, enabled = $7
       WHERE id = $1 AND ${s.sql} RETURNING *`,
      [id, ...vals, ...s.args]
    )
    return q.rows[0] ?? null
  }
  const q = await pool.query(
    `INSERT INTO social_autopost_rules (tenant_id, trigger, platforms, template_id, min_drop_pct, require_approval, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId, ...vals]
  )
  return q.rows[0]
}

export async function deleteRule(tenantId: string | null, id: string): Promise<boolean> {
  const s = scoped(tenantId, 2)
  const r = await controlPlanePool().query(`DELETE FROM social_autopost_rules WHERE id = $1 AND ${s.sql}`, [id, ...s.args])
  return (r.rowCount ?? 0) > 0
}
