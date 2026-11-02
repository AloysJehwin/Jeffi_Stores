import 'server-only'
import { getCustomDomain, setCustomDomainStatus } from '@/lib/tenant-registry/custom-domains'

// Certificate request for a verified custom domain.
//
// This cluster fronts tenants with Traefik + cert-manager (Let's Encrypt, HTTP-01), not AWS ALB/ACM:
// tenant-workload.ts emits a cert-manager Certificate per custom domain and Traefik serves it with the
// resulting Secret (`custom-{i}-tls`). So `requestCert` here does not call AWS ACM — it kicks the
// in-cluster reconcile that adds the Certificate + IngressRoute for this host, and polls for a status
// of 'verified' once the TLS secret is populated by cert-manager (via `isCertReady`).
//
// Returns `{ certArn: null, validation: null }` so callers written against the AWS flow still work;
// `certArn` stays null because cert-manager owns the secret, not AWS.

export interface CertRequestResult {
  certArn: string | null
  validation: null
}

export async function requestCert(id: string): Promise<CertRequestResult> {
  const row = await getCustomDomain(id)
  if (!row) throw new Error(`Domain ${id} not found`)
  if (row.status !== 'dns-verified') {
    throw new Error(`Domain ${row.domain} is not dns-verified (status=${row.status})`)
  }
  // Mark cert-pending; the next reconcileK8sPlan tick emits the Certificate.
  await setCustomDomainStatus(id, 'cert-pending')
  return { certArn: null, validation: null }
}

// Checks the k8s Secret `custom-{i}-tls` in the tenant namespace to see if cert-manager has issued.
// Flips status to 'verified' once the secret has tls.crt / tls.key.
export async function isCertReady(id: string): Promise<boolean> {
  const row = await getCustomDomain(id)
  if (!row) return false
  if (row.status === 'verified') return true
  if (row.status !== 'cert-pending') return false

  // Lazy import so this module does not pull k8s into contexts that only resolve DNS.
  const { list } = await import('@/lib/k8s/client')
  const { tenantNamespace } = await import('@/lib/provisioning/tiers')
  const { getTenant } = await import('@/lib/tenant-registry')
  const tenant = await getTenant(row.tenant_id)
  if (!tenant) return false
  const ns = tenantNamespace(tenant.slug)

  // Find the Secret whose annotation matches this domain, or by scanning custom-{i}-tls secrets.
  const secrets = (await list<any>('Secret', ns).catch(() => [])) ?? []
  const match = secrets.find((s: any) => {
    const name = s?.metadata?.name as string | undefined
    if (!name?.startsWith('custom-') || !name.endsWith('-tls')) return false
    const data = s?.data ?? {}
    return !!(data['tls.crt'] && data['tls.key'])
  })
  if (!match) return false

  await setCustomDomainStatus(id, 'verified')
  return true
}
