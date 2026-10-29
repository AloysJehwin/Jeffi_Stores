import { getAdminSession } from '@/lib/auth/admin-auth'
import { PageBody, PageHeader } from '@/components/admin/kit'
import SupportInbox from '@/components/admin/support/SupportInbox'

export const dynamic = 'force-dynamic'

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ s?: string; filter?: string }> }) {
  const [{ s, filter }, admin] = await Promise.all([searchParams, getAdminSession()])
  return (
    <PageBody>
      <PageHeader title="Support" description="Customer chats from the website, app, WhatsApp and email. The assistant answers first and hands over when a person is needed." />
      <SupportInbox initialId={s ?? null} initialFilter={filter === 'approval' ? 'approval' : null} me={admin?.adminId ?? null} />
    </PageBody>
  )
}
