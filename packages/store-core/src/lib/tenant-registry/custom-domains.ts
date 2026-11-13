import { controlPlanePool } from './shared'
import { clearTenantCache } from './host-resolution'

export interface CustomDomain {
  id: string
  tenant_id: string
  domain: string
  status: string
  verification_token: string | null
  cert_arn: string | null
  /** Set on the apex/www/admin rows of a domain bought through the platform; its order manages them. */
  order_id: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

const COLS = 'id, tenant_id, domain, status, verification_token, cert_arn, order_id, verified_at, created_at, updated_at'
const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
// First labels the platform routes by name (host-resolution APP_PREFIXES, middleware public./img./…).
const RESERVED_LABELS = new Set(['admin', 'invoice', 'quotation', 'purchaseorder', 'forms', 'business', 'vault', 'public', 'img', 'certificate', 'ecom'])
/** A claim that never completed stops blocking the name (and the quota) after this. */
const STALE_CLAIM_MS = 48 * 60 * 60 * 1000
/** Statuses that take a slot: everything still live or on its way. Bought domains don't use the plan's quota. */
const ACTIVE = `status NOT IN ('expired','failed') AND order_id IS NULL`

/** Domains the cluster routes and issues certificates for: cert-manager's HTTP-01 needs the Certificate before it can issue. */
export async function routedCustomDomains(tenantId: string): Promise<string[]> {
  const res = await controlPlanePool().query(
    `SELECT domain FROM tenant_custom_domains WHERE tenant_id=$1 AND status IN ('cert-pending','verified') ORDER BY created_at ASC`,
    [tenantId]
  )
  return res.rows.map(r => r.domain)
}

/** The owner's own (bring-your-own) domains; a bought domain's hosts are listed with its order. */
export async function listCustomDomains(tenantId: string): Promise<CustomDomain[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT ${COLS} FROM tenant_custom_domains WHERE tenant_id=$1 AND order_id IS NULL ORDER BY created_at ASC`,
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
  if (clean === ROOT || clean.endsWith('.' + ROOT))
    return { ok: false, error: `Cannot use a ${ROOT} address as a custom domain` }
  if (RESERVED_LABELS.has(clean.split('.')[0]))
    return { ok: false, error: `A domain starting with "${clean.split('.')[0]}." is reserved. Use another subdomain, such as shop. or www.` }

  // Quota check
  const quotaRes = await pool.query(
    `SELECT COALESCE(p.max_custom_domains, 0) AS max, COUNT(cd.id) AS used
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_custom_domains cd ON cd.tenant_id = t.id AND cd.${ACTIVE}
     WHERE t.id = $1
     GROUP BY p.max_custom_domains`,
    [tenantId]
  )
  const q = quotaRes.rows[0]
  const max = Number(q?.max ?? 0)
  const used = Number(q?.used ?? 0)
  if (max === 0) return { ok: false, error: 'Custom domains are available on Pro plan and above' }
  if (used >= max) return { ok: false, error: `Domain limit reached (${max} for your plan)` }

  // Uniqueness. A claim that never got past DNS (or failed/expired) is released after 48h so a
  // squatter or an abandoned attempt can't hold the name forever.
  const dup = await pool.query(
    `SELECT id, status, updated_at FROM tenant_custom_domains WHERE domain=$1`,
    [clean]
  )
  const held = dup.rows[0]
  if (held) {
    const released = held.status !== 'verified' && held.status !== 'cert-pending' && Date.now() - new Date(held.updated_at).getTime() > STALE_CLAIM_MS
    if (!released) return { ok: false, error: 'This domain is already registered' }
    await pool.query(`DELETE FROM tenant_custom_domains WHERE id=$1`, [held.id])
  }

  const token = 'jeffi-verify-' + Math.random().toString(36).slice(2, 14)
  const res = await pool.query(
    `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token)
     VALUES ($1, $2, 'pending', $3)
     RETURNING ${COLS}`,
    [tenantId, clean, token]
  )
  clearTenantCache()
  return { ok: true, domain: res.rows[0] }
}

/** Move a custom domain along its pending → dns-verified → cert-pending → verified path. */
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
    `SELECT ${COLS} FROM tenant_custom_domains WHERE id=$1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function deleteCustomDomain(id: string, tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`DELETE FROM tenant_custom_domains WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
  clearTenantCache()
}
