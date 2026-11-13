import 'server-only'
import { promises as dns } from 'node:dns'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { getCustomDomain, type CustomDomain } from '@/lib/tenant-registry/custom-domains'
import { verifyDomain } from './dns-verify'
import { requestCert, isCertReady } from './acm'

// pending       → TXT `_jeffi.{domain}` matches → dns-verified
// dns-verified  → the domain resolves to the cluster → cert-pending (+ reconcile: Certificate + route rendered)
// cert-pending  → cert-manager's Certificate is Ready → verified (+ reconcile); failed after 24h

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

/** Whether the domain's A records reach the same ingress IP as the store's own subdomain (CNAME or A). */
export async function pointsAtCluster(domain: string, slug: string): Promise<boolean> {
  const resolve = (h: string) => dns.resolve4(h).catch(() => [] as string[])
  const [mine, target] = await Promise.all([resolve(domain), resolve(`${slug}.${ROOT}`)])
  const ingress = new Set([...target, ...(process.env.CLUSTER_INGRESS_IP ? [process.env.CLUSTER_INGRESS_IP] : [])])
  return mine.length > 0 && mine.every(ip => ingress.has(ip))
}

export interface DomainStep {
  status: string
  /** The tenant whose routes/certificates must be re-rendered. */
  reconcile?: string
  message?: string
}

/** Move one domain forward as far as it can go right now. */
export async function advanceDomain(row: CustomDomain): Promise<DomainStep> {
  let status = row.status
  if (status === 'pending') {
    const out = await verifyDomain(row.id)
    if (!out.ok) return { status: out.status, message: out.error }
    status = 'dns-verified'
  }
  if (status === 'dns-verified') {
    const slug = (await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [row.tenant_id])).rows[0]?.slug
    if (!slug || !(await pointsAtCluster(row.domain, slug))) {
      return { status, message: `Point ${row.domain} at ${slug}.${ROOT} (CNAME) or our IP (A record) to issue the certificate.` }
    }
    await requestCert(row.id)
    return { status: 'cert-pending', reconcile: row.tenant_id, message: 'Issuing the certificate. This usually takes a few minutes.' }
  }
  if (status === 'cert-pending') {
    if (await isCertReady(row.id)) return { status: 'verified', reconcile: row.tenant_id, message: 'Live.' }
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

  for (const { id } of res.rows as Array<{ id: string }>) {
    try {
      const row = await getCustomDomain(id)
      if (!row) continue
      const step = await advanceDomain(row)
      if (step.status !== row.status) advanced++
      if (step.reconcile) tenantsToReconcile.add(step.reconcile)
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  for (const tenantId of tenantsToReconcile) {
    await reconcileDomains(tenantId).catch(e => errors.push({ id: tenantId, error: `reconcile: ${e instanceof Error ? e.message : String(e)}` }))
  }
  return { checked: res.rows.length, advanced, errors }
}
