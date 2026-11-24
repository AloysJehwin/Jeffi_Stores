import { priceList } from '@jeffi/pricing'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { serviceStates } from '@controller/lib/ecom/service-states'
import { hasService, getKyc } from '@/lib/tenant-registry'
import { getTenantWallet } from '@/lib/payments/wallet'
import PageHeader from '../_components/PageHeader'
import ServiceNotOn from '../services/ServiceNotOn'
import DocumentsClient from './DocumentsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Documents' }

export default async function DocumentsPage() {
  const { tenant } = await loadOwnerContext()
  const enabled = hasService(tenant, 'documents')
  const [kyc, wallet] = enabled ? await Promise.all([getKyc(tenant.id).catch(() => null), getTenantWallet(tenant.id, 0).catch(() => null)]) : [null, null]
  // Bulk renders print the workspace's business details as the seller.
  const seller = kyc?.business_name ? {
    name: kyc.business_name,
    gstin: kyc.gst_number?.length === 15 ? kyc.gst_number : undefined,
    address: kyc.business_address ?? undefined,
    phone: kyc.mobile ?? undefined,
  } : null
  if (enabled) {
    return <DocumentsClient seller={seller} prices={priceList().documents} balance={Number(wallet?.balance ?? 0)} />
  }
  const { documents } = await serviceStates(tenant)
  return (
    <>
      <PageHeader eyebrow="Developers" title="Documents" description="Every PDF rendered through your API keys, and the design they use." />
      <ServiceNotOn service="documents" state={documents} />
    </>
  )
}
