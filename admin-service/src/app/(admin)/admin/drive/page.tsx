import { PageBody, PageHeader } from '@/components/admin/kit'
import DriveBrowser from '@/components/admin/drive/DriveBrowser'

export const dynamic = 'force-dynamic'

export default async function DrivePage({ searchParams }: { searchParams: Promise<{ folder?: string; trash?: string }> }) {
  const { folder, trash } = await searchParams
  return (
    <PageBody>
      <PageHeader title="Drive" description="Private files for your team: folders, sharing, and the public gallery. Chat and assistant attachments land here too." />
      <DriveBrowser initialFolder={folder ?? 'root'} initialTrash={trash === '1'} />
    </PageBody>
  )
}
