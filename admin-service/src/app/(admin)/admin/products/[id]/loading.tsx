import { PageLoading } from '@/components/admin/kit/skeleton'

// Shared by the redirect and every page below it (view, edit, analytics): the header they all start with.
export default function Loading() {
  return <PageLoading back="Products" />
}
