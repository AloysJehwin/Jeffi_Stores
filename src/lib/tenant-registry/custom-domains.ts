import { controlPlanePool } from './shared'
import { clearTenantCache } from './host-resolution'

export interface CustomDomain {
  id: string
  tenant_id: string
  domain: string
  status: string
  verification_token: string | null
  cert_arn: string | null
  verified_at: string | null
  created_at: string
}

export async function listCustomDomains(tenantId: string): Promise<CustomDomain[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at
     FROM tenant_custom_domains WHERE tenant_id=$1 ORDER BY created_at ASC`,
    [tenantId]
  )
  return res.rows
}

/** Add a custom domain — enforces the plan's max_custom_domains quota. */
export async function addCustomDomain(
  tenantId: string,
  domain: string
): Promise<{ ok: true; domain: CustomDomain } | { ok: false; error: string }> {
  const pool = controlPlanePool()
  const clean = domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(clean)) return { ok: false, error: 'Invalid domain format' }
  if (clean.endsWith('.jeffistores.in'))
    return { ok: false, error: 'Cannot use a jeffistores.in subdomain as a custom domain' }

  // Quota check
  const quotaRes = await pool.query(
    `SELECT COALESCE(p.max_custom_domains, 0) AS max, COUNT(cd.id) AS used
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_custom_domains cd ON cd.tenant_id = t.id
     WHERE t.id = $1
     GROUP BY p.max_custom_domains`,
    [tenantId]
  )
  const q = quotaRes.rows[0]
  const max = Number(q?.max ?? 0)
  const used = Number(q?.used ?? 0)
  if (max === 0) return { ok: false, error: 'Custom domains are available on Pro plan and above' }
  if (used >= max) return { ok: false, error: `Domain limit reached (${max} for your plan)` }

  // Uniqueness
  const dup = await pool.query(`SELECT 1 FROM tenant_custom_domains WHERE domain=$1`, [clean])
  if (dup.rows[0]) return { ok: false, error: 'This domain is already registered' }

  const token = 'jeffi-verify-' + Math.random().toString(36).slice(2, 14)
  const res = await pool.query(
    `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at`,
    [tenantId, clean, token]
  )
  clearTenantCache()
  return { ok: true, domain: res.rows[0] }
}

/** Mark a custom domain verified (called after DNS CNAME check passes). */
export async function setCustomDomainStatus(id: string, status: string, certArn?: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_custom_domains
     SET status=$1, cert_arn=COALESCE($2, cert_arn),
         verified_at=CASE WHEN $1='verified' THEN now() ELSE verified_at END,
         updated_at=now()
     WHERE id=$3`,
    [status, certArn ?? null, id]
  )
  clearTenantCache()
}

export async function getCustomDomain(id: string): Promise<CustomDomain | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at
     FROM tenant_custom_domains WHERE id=$1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function deleteCustomDomain(id: string, tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`DELETE FROM tenant_custom_domains WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
  clearTenantCache()
}
