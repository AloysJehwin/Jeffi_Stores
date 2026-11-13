import 'server-only'
import type { DomainHosting } from './types'

// The store's routes and certificates in the cluster: the same renderer the bring-your-own flow uses
// (tenant-workload.ts renders a Certificate + IngressRoute per routed custom domain; admin.<domain> gets
// the admin route behind the tenant mTLS option). In-cluster only.
export class ClusterHosting implements DomainHosting {
  readonly live = true

  async applyRoutes(tenantId: string) {
    const { reconcileDomains } = await import('../verify-cron')
    await reconcileDomains(tenantId)
  }

  async certReady(tenantSlug: string, host: string) {
    const { get } = await import('@/lib/k8s/client')
    const { customDomainName } = await import('@/lib/k8s/tenant-workload')
    const { tenantNamespace } = await import('@/lib/provisioning/tiers')
    const cert = await get<any>('Certificate', customDomainName(host), tenantNamespace(tenantSlug)).catch(() => null)
    return (cert?.status?.conditions ?? []).some((c: any) => c.type === 'Ready' && c.status === 'True')
  }
}
