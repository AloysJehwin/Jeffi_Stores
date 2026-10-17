import { BackLink } from '@/components/admin/kit'
import CampaignDetailClient from '../CampaignDetailClient'
import ReorderIntervalsPanel from '../ReorderIntervalsPanel'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignEditPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6 space-y-5 [&>a:first-child]:capitalize">
      <BackLink href={ap(`/admin/campaigns/${kind}/view`, host)} label={kind.replace(/_/g, ' ')} />

      {/* The block builder / rich editor aren't usable on a phone — editing is desktop-only. */}
      <MobileEditBlock>
        <CampaignDetailClient kind={kind} />
        {kind === 'replenishment' && <ReorderIntervalsPanel />}
      </MobileEditBlock>
    </div>
  )
}
