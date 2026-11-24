import { LoadingTable, PageLoading } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <PageLoading title="Outreach" description="The AI caller program: lists, contacts, calls and suppressions.">
      <LoadingTable columns={['Business', 'Phone', 'City', 'Language', 'Status', 'Attempts']} title="Contacts" />
    </PageLoading>
  )
}
