import type { TenantContext } from './context'
import { controlPlanePool } from './pools'
import { slugFromHost } from './hosts'

const cache = new Map<string, { ctx: TenantContext | null; expires: number }>()
const TTL = 60_000

const SELECT = `SELECT t.id, t.slug, t.display_name, t.status, p.slug AS plan,
  i.rds_endpoint, i.rds_db, i.rds_port, i.rds_user, i.db_secret_ref, i.iam_auth, i.s3_bucket, i.region
  FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id LEFT JOIN tenant_infra i ON i.tenant_id = t.id`

function toCtx(r: any): TenantContext | null {
  if (!r || r.status !== 'active') return null
  return {
    tenantId: r.id,
    slug: r.slug,
    displayName: r.display_name ?? null,
    plan: r.plan ?? null,
    infra: r.rds_endpoint
      ? {
          rdsEndpoint: r.rds_endpoint,
          rdsDb: r.rds_db || 'jeffi_stores',
          rdsPort: r.rds_port || 5432,
          rdsUser: r.rds_user ?? null,
          dbSecretRef: r.db_secret_ref ?? null,
          iamAuth: r.iam_auth !== false,
          s3Bucket: r.s3_bucket ?? null,
          region: r.region || 'us-east-1',
        }
      : null,
  }
}

async function lookup(where: 'slug' | 'custom_domain' | 'id', value: string): Promise<TenantContext | null> {
  const clause =
    where === 'custom_domain'
      ? `t.id = (SELECT tenant_id FROM tenant_custom_domains WHERE domain = $1 AND status = 'verified'
                 UNION ALL SELECT id FROM tenants WHERE custom_domain = $1 LIMIT 1)`
      : `t.${where} = $1`
  const res = await controlPlanePool().query(`${SELECT} WHERE ${clause} LIMIT 1`, [value])
  return toCtx(res.rows[0])
}

async function cached(key: string, fn: () => Promise<TenantContext | null>): Promise<TenantContext | null> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expires > now) return hit.ctx
  const ctx = await fn()
  cache.set(key, { ctx, expires: now + TTL })
  return ctx
}

export function resolveTenantFromHost(hostname: string): Promise<TenantContext | null> {
  const host = hostname.toLowerCase().split(':')[0]
  const { slug, isCustomDomain } = slugFromHost(host)
  return cached(`host:${host}`, async () => {
    if (slug) return lookup('slug', slug)
    if (isCustomDomain) return lookup('custom_domain', host)
    return null
  })
}

export const lookupTenantContextBySlug = (slug: string) => cached(`slug:${slug}`, () => lookup('slug', slug))
export const lookupTenantContextById = (id: string) => cached(`id:${id}`, () => lookup('id', id))
export const clearTenantCache = () => cache.clear()
