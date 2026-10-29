import { getAdminSession } from '@/lib/auth/admin-auth'
import { PageBody, PageHeader } from '@/components/admin/kit'
import SupportInbox from '@/components/admin/support/SupportInbox'

export const dynamic = 'force-dynamic'

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const [{ s }, admin] = await Promise.all([searchParams, getAdminSession()])
  return (
    <PageBody>
      <PageHeader title="Support" description="Customer chats from the website, app and WhatsApp. The assistant answers first and hands over when a person is needed." />
      <SupportInbox initialId={s ?? null} me={admin?.adminId ?? null} />
    </PageBody>
  )
}
