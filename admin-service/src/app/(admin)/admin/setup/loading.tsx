import { PageLoading } from '@/components/admin/kit/skeleton'
import SetupGuideLoading from './_components/SetupLoading'

export default function Loading() {
  return (
    <PageLoading title="Setup guide" description="Everything to set up, connect and get approved, with what is already done ticked off.">
      <SetupGuideLoading />
    </PageLoading>
  )
}
