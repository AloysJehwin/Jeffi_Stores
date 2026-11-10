import { PageLoading } from '@/components/admin/kit/skeleton'
import DriveBrowserLoading from '@/components/admin/drive/DriveLoading'

export default function Loading() {
  return (
    <PageLoading title="Drive" description="Private files for your team: folders, sharing, and the public gallery. Chat and assistant attachments land here too.">
      <DriveBrowserLoading />
    </PageLoading>
  )
}
