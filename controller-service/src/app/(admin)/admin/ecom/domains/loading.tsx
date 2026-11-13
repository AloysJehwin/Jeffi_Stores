import { LoadingKpis, LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="Domains" description="Domains stores bought through the platform: status, expiry and renewal, what AWS charges against what the store paid, and the margin.">
      <LoadingKpis labels={['Live domains', 'Yearly revenue', 'Yearly AWS cost', 'Renewals at risk']} />
      <LoadingTable columns={['Domain', 'Store', 'Status', 'Expires', 'Renewal', 'Cost', 'Price', 'Margin']} title="Bought domains" />
    </PageLoading>
  )
}
