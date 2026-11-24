import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { requireStore } from '@controller/lib/ecom/require-store'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import SubdomainList from '../SubdomainList'
import CustomDomains from '../CustomDomains'
import DomainPurchase from '../DomainPurchase'
import { listPlans, ownDomainFrom } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Domains' }

export default async function DomainsPage() {
  const [{ tenant }, plans] = await Promise.all([loadOwnerContext(), listPlans().catch(() => [])])
  requireStore(tenant)
  const from = ownDomainFrom(plans)
  return (
    <>
      <PageHeader eyebrow="Store" title="Domains" description="Where your store, admin and service portals live. Buy a new domain for them, or connect one you already have." />
      <div className="space-y-6">
        <Card title="Your subdomains">
          <SubdomainList slug={tenant.slug} plan={tenant.plan} rdsReady={!!tenant.rds_endpoint} />
        </Card>
        <DomainPurchase tenantId={tenant.id} tenantSlug={tenant.slug} />
        <CustomDomains tenantId={tenant.id} slug={tenant.slug} maxDomains={tenant.max_custom_domains ?? 0} ownDomainFrom={from} />
      </div>
    </>
  )
}
