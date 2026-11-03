import 'server-only'
import { getCustomDomain, setCustomDomainStatus } from '@/lib/tenant-registry/custom-domains'

// Certificates for custom domains come from cert-manager (Let's Encrypt, HTTP-01), not AWS ACM:
// tenant-workload.ts renders a Certificate + IngressRoute for every cert-pending or verified domain,
// and Traefik serves the issued Secret. `certArn` stays null because cert-manager owns the secret.

export interface CertRequestResult {
  certArn: string | null
  validation: null
}

/** How long cert-manager gets to issue before the domain is marked failed (usually minutes). */
const ISSUE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Mark the domain cert-pending; the caller then reconciles the tenant so the Certificate is applied. */
export async function requestCert(id: string): Promise<CertRequestResult> {
  const row = await getCustomDomain(id)
  if (!row) throw new Error(`Domain ${id} not found`)
  if (row.status !== 'dns-verified') {
    throw new Error(`Domain ${row.domain} is not dns-verified (status=${row.status})`)
  }
  await setCustomDomainStatus(id, 'cert-pending')
  return { certArn: null, validation: null }
}

/** Flip to 'verified' once this domain's own Certificate is Ready; to 'failed' if it never issues. */
export async function isCertReady(id: string): Promise<boolean> {
  const row = await getCustomDomain(id)
  if (!row) return false
  if (row.status === 'verified') return true
  if (row.status !== 'cert-pending') return false

  // Lazy import so this module does not pull k8s into contexts that only resolve DNS.
  const { get } = await import('@/lib/k8s/client')
  const { customDomainName } = await import('@/lib/k8s/tenant-workload')
  const { tenantNamespace } = await import('@/lib/provisioning/tiers')
  const { getTenant } = await import('@/lib/tenant-registry')
  const tenant = await getTenant(row.tenant_id)
  if (!tenant) return false

  const cert = await get<any>('Certificate', customDomainName(row.domain), tenantNamespace(tenant.slug)).catch(() => null)
  const ready = (cert?.status?.conditions ?? []).find((c: any) => c.type === 'Ready')
  if (ready?.status === 'True') {
    await setCustomDomainStatus(id, 'verified')
    return true
  }
  if (Date.now() - new Date(row.updated_at).getTime() > ISSUE_TIMEOUT_MS) await setCustomDomainStatus(id, 'failed')
  return false
}
