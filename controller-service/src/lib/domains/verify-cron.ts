import 'server-only'
import { promises as dns } from 'node:dns'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { getCustomDomain, type CustomDomain } from '@/lib/tenant-registry/custom-domains'
import { verifyDomain } from './dns-verify'
import { requestCert, isCertReady } from './acm'

// pending       → TXT `_jeffi.{domain}` matches → dns-verified
// dns-verified  → the domain resolves to the cluster → cert-pending (+ reconcile: Certificate + route rendered)
// cert-pending  → cert-manager's Certificate is Ready → verified (+ reconcile); failed after 24h
// A Showcase's domain points at site-{slug}.<root>, and its route and certificate are showcase-service's
// (showcase-routes.ts); once live the site answers on it (showcase_sites.custom_domain).

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

/** Whether the domain's A records reach the same ingress IP as the store's own subdomain (CNAME or A). */
export async function pointsAtCluster(domain: string, slug: string): Promise<boolean> {
  return pointsAtHost(domain, `${slug}.${ROOT}`)
}

async function pointsAtHost(domain: string, host: string): Promise<boolean> {
  const resolve = (h: string) => dns.resolve4(h).catch(() => [] as string[])
  const [mine, target] = await Promise.all([resolve(domain), resolve(host)])
  const ingress = new Set([...target, ...(process.env.CLUSTER_INGRESS_IP ? [process.env.CLUSTER_INGRESS_IP] : [])])
  return mine.length > 0 && mine.every(ip => ingress.has(ip))
}

export interface DomainStep {
  status: string
  /** The tenant whose routes/certificates must be re-rendered. */
  reconcile?: string
  /** The Showcase routes must be re-rendered instead. */
  showcase?: boolean
  message?: string
}

/** The address a Showcase domain points at, from its site. */
async function showcaseTarget(siteId: string): Promise<string | null> {
  const { getShowcaseById } = await import('@/lib/showcase/store')
  const { showcaseHost } = await import('@/lib/showcase/host')
  const site = await getShowcaseById(siteId)
  return site ? showcaseHost(site.slug) : null
}

/** Move one domain forward as far as it can go right now. */
export async function advanceDomain(row: CustomDomain): Promise<DomainStep> {
  let status = row.status
  if (status === 'pending') {
    const out = await verifyDomain(row.id)
    if (!out.ok) return { status: out.status, message: out.error }
    status = 'dns-verified'
  }
  const site = row.showcase_site_id
  const target = site ? { showcase: true } : { reconcile: row.tenant_id }
  if (status === 'dns-verified') {
    const slug = site ? null : (await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [row.tenant_id])).rows[0]?.slug
    const host = site ? await showcaseTarget(site) : slug ? `${slug}.${ROOT}` : null
    if (!host || !(await pointsAtHost(row.domain, host))) {
      return { status, message: `Point ${row.domain} at ${host} (CNAME) or our IP (A record) to issue the certificate.` }
    }
    await requestCert(row.id)
    return { status: 'cert-pending', ...target, message: 'Issuing the certificate. This usually takes a few minutes.' }
  }
  if (status === 'cert-pending') {
    if (await isCertReady(row.id)) {
      if (site) {
        const { setShowcaseCustomDomain } = await import('@/lib/showcase/domain')
        await setShowcaseCustomDomain(site, row.domain)
      }
      return { status: 'verified', ...target, message: 'Live.' }
    }
    const now = await getCustomDomain(row.id)
    return { status: now?.status ?? status, message: now?.status === 'failed' ? 'The certificate could not be issued. Check the DNS record and try again.' : 'Issuing the certificate.' }
  }
  return { status }
}

/** Re-render the tenant's namespace so the Certificate/IngressRoute set matches its domains. */
export async function reconcileDomains(tenantId: string): Promise<void> {
  const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
  const { getProvisioningProvider } = await import('@controller/lib/provisioning')
  await reconcileK8sPlan(tenantId, getProvisioningProvider(), { force: true })
}

/** Re-render every Showcase domain's route and certificate beside showcase-service. */
export async function reconcileShowcaseDomains(): Promise<void> {
  const { applyShowcaseRoutes } = await import('./showcase-routes')
  await applyShowcaseRoutes()
}

export async function runDomainVerifyCron(): Promise<{
  checked: number
  advanced: number
  errors: Array<{ id: string; error: string }>
}> {
  const res = await controlPlanePool().query(
    `SELECT id FROM tenant_custom_domains WHERE status IN ('pending','dns-verified','cert-pending') AND order_id IS NULL`
  )
  let advanced = 0
  const errors: Array<{ id: string; error: string }> = []
  const tenantsToReconcile = new Set<string>()
  let showcase = false

  for (const { id } of res.rows as Array<{ id: string }>) {
    try {
      const row = await getCustomDomain(id)
      if (!row) continue
      const step = await advanceDomain(row)
      if (step.status !== row.status) advanced++
      if (step.reconcile) tenantsToReconcile.add(step.reconcile)
      if (step.showcase) showcase = true
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  for (const tenantId of tenantsToReconcile) {
    await reconcileDomains(tenantId).catch(e => errors.push({ id: tenantId, error: `reconcile: ${e instanceof Error ? e.message : String(e)}` }))
  }
  if (showcase) await reconcileShowcaseDomains().catch(e => errors.push({ id: 'showcase', error: `reconcile: ${e instanceof Error ? e.message : String(e)}` }))
  return { checked: res.rows.length, advanced, errors }
}
