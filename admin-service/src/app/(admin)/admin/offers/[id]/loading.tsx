import { PageLoading } from '@/components/admin/kit/skeleton'

// Shared by the redirect and every page below it (view, edit): the header they all start with.
export default function Loading() {
  return <PageLoading back="Offers" />
}
