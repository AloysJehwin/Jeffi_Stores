import { PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { LoadingTabBar } from '../../products/_components/loading-parts'
import { MessagingOverviewTabLoading } from './_components/MessagingLoading'

export default function Loading() {
  return (
    // The description names only the channels Site Controls leaves on.
    <PageLoading title="Messaging" description={<Sk className="mt-1 h-3.5 w-72" />}>
      <LoadingTabBar tabs={['Overview', 'Messages', 'Drafts']} actions={1} />
      <MessagingOverviewTabLoading />
    </PageLoading>
  )
}
