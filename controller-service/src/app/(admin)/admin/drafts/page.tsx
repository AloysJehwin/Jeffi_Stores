import { PageBody, PageHeader } from '@/components/admin/kit'
import DraftsClient from './DraftsClient'

export const dynamic = 'force-dynamic'

// Who is editing which draft. Rows are limited to the draft types the admin can read.
export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const scope = tab === 'all' ? 'all' : tab === 'unclaimed' ? 'unclaimed' : 'mine'
  return (
    <PageBody>
      <PageHeader title="Drafts" description="Drafts in progress, who holds each one, and handover between admins" />
      <DraftsClient initialScope={scope} />
    </PageBody>
  )
}
