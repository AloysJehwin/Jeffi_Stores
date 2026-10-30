import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

// Drafts show on each list page (PageDrafts); old links land on the dashboard.
export default async function DraftsPage() {
  redirect(ap('/admin/dashboard', await getHost()))
}
