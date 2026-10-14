import { loadOwnerContext } from '@/lib/ecom/owner-context'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import SubdomainList from '../SubdomainList'
import CustomDomains from '../CustomDomains'

export const dynamic = 'force-dynamic'

export default async function DomainsPage() {
  const { tenant } = await loadOwnerContext()
  return (
    <>
      <PageHeader eyebrow="Store" title="Domains" description="Where your store, admin and service portals live." />
      <div className="space-y-6">
        <Card title="Your subdomains">
          <SubdomainList
            slug={tenant.slug}
            plan={tenant.plan}
            maxCustomDomains={tenant.max_custom_domains ?? 0}
            rdsReady={!!tenant.rds_endpoint}
          />
        </Card>
        <CustomDomains tenantId={tenant.id} slug={tenant.slug} maxDomains={tenant.max_custom_domains ?? 0} />
      </div>
    </>
  )
}
