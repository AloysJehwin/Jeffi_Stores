import { BackLink } from '@/components/admin/kit'
import CampaignViewClient from './CampaignViewClient'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignViewPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <BackLink href={ap('/admin/campaigns', host)} label={'Campaigns'} />
      <CampaignViewClient kind={kind} />
    </div>
  )
}
