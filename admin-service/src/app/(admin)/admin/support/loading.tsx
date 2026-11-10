import { PageLoading } from '@/components/admin/kit/skeleton'
import SupportInboxLoading from '@/components/admin/support/SupportInboxLoading'

export default function Loading() {
  return (
    <PageLoading title="Support" description="Customer chats from the website, app, WhatsApp and email. The assistant answers first and hands over when a person is needed.">
      <SupportInboxLoading />
    </PageLoading>
  )
}
