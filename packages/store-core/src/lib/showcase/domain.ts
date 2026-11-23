import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { checkCustomDomainName, releaseDomainClaim, type CustomDomain } from '@/lib/tenant-registry/custom-domains'

// A Showcase's own domain: tenant_custom_domains rows with showcase_site_id, connected here or bought through the
// controller's lib/domains/orders.ts. showcase-service answers them (getShowcaseByHost reads custom_domain, set once
// the host is live). One domain per site.

const COLS = 'id, tenant_id, domain, status, verification_token, cert_arn, order_id, showcase_site_id, verified_at, created_at, updated_at'

/** The hosts a domain bought for a Showcase serves: the apex and www., never a store's admin./invoice./… hosts. */
export const showcaseDomainHosts = (domain: string) => [domain, `www.${domain}`]

/** Every Showcase host the cluster routes to showcase-service and issues a certificate for. */
export async function routedShowcaseDomains(): Promise<string[]> {
  const r = await controlPlanePool().query(
    `SELECT domain FROM tenant_custom_domains WHERE showcase_site_id IS NOT NULL AND status IN ('cert-pending','verified') ORDER BY created_at`
  )
  return r.rows.map(x => x.domain)
}

/** The site's connected domains; a bought domain's hosts are listed with its order. */
export async function listShowcaseDomains(siteId: string): Promise<CustomDomain[]> {
  const r = await controlPlanePool().query(
    `SELECT ${COLS} FROM tenant_custom_domains WHERE showcase_site_id = $1 AND order_id IS NULL ORDER BY created_at`,
    [siteId]
  )
  return r.rows
}

/** The domain the site already has, connected or bought, live or on its way; null when it has none. */
export async function showcaseDomainInUse(siteId: string): Promise<string | null> {
  const r = await controlPlanePool().query(
    `SELECT domain FROM tenant_custom_domains WHERE showcase_site_id = $1 AND order_id IS NULL AND status NOT IN ('expired','failed')
     UNION ALL
     SELECT domain FROM tenant_domain_orders WHERE showcase_site_id = $1 AND status NOT IN ('failed','cancelled','expired')
     LIMIT 1`,
    [siteId]
  )
  return r.rows[0]?.domain ?? null
}

/** Connect a domain the owner already has; it goes live once its TXT record and pointing record check out. */
export async function connectShowcaseDomain(
  site: { id: string; tenantId: string },
  raw: string
): Promise<{ ok: true; domain: CustomDomain } | { ok: false; error: string }> {
  const name = checkCustomDomainName(raw)
  if (!name.ok) return name
  const inUse = await showcaseDomainInUse(site.id)
  if (inUse) return { ok: false, error: `This site already has ${inUse}. Remove it first.` }
  if (!(await releaseDomainClaim(name.domain))) return { ok: false, error: 'This domain is already registered' }
  const token = 'jeffi-verify-' + Math.random().toString(36).slice(2, 14)
  try {
    const r = await controlPlanePool().query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token, showcase_site_id)
       VALUES ($1, $2, 'pending', $3, $4) RETURNING ${COLS}`,
      [site.tenantId, name.domain, token, site.id]
    )
    return { ok: true, domain: r.rows[0] }
  } catch (e: any) {
    if (e?.code === '23505') return { ok: false, error: 'This domain is already registered' }
    throw e
  }
}

/** The site answers on its live domain. False when another site already holds the name. */
export async function setShowcaseCustomDomain(siteId: string, domain: string): Promise<boolean> {
  try {
    await controlPlanePool().query(
      `UPDATE showcase_sites SET custom_domain = $2, updated_at = now() WHERE id = $1 AND custom_domain IS DISTINCT FROM $2`,
      [siteId, domain]
    )
    return true
  } catch (e: any) {
    if (e?.code !== '23505') throw e
    console.warn(`[showcase] ${domain} is another site's custom domain; ${siteId} not pointed at it`)
    return false
  }
}

/** Unset the site's domain when that domain is removed, cancelled or expires (a different one stays). */
export async function clearShowcaseCustomDomain(siteId: string, domain: string): Promise<void> {
  await controlPlanePool().query(`UPDATE showcase_sites SET custom_domain = NULL, updated_at = now() WHERE id = $1 AND custom_domain = $2`, [siteId, domain])
}
