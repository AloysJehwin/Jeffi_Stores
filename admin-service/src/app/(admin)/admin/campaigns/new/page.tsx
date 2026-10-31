import { BackLink } from '@/components/admin/kit'
import NewCampaignClient from './NewCampaignClient'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import MobileEditBlock from '@/components/admin/MobileEditBlock'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function NewCampaignPage() {
  const host = await getHost()
  return (
    <MobileEditBlock>
      <div className="p-4 sm:p-6 space-y-5">
        <BackLink href={ap('/admin/campaigns', host)} label={'Campaigns'} />
        <NewCampaignClient />
      </div>
    </MobileEditBlock>
  )
}
