import Link from 'next/link'
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
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/campaigns', host)} className="text-accent-500 hover:text-accent-600 transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={ap(`/admin/campaigns/${kind}/view`, host)}
          className="text-accent-500 hover:text-accent-600 transition-colors capitalize"
        >
          {kind.replace(/_/g, ' ')}
        </Link>
        <span>/</span>
        <span className="text-foreground">Edit</span>
      </div>

      {/* The block builder / rich editor aren't usable on a phone — editing is desktop-only. */}
      <MobileEditBlock>
        <CampaignDetailClient kind={kind} />
        {kind === 'replenishment' && <ReorderIntervalsPanel />}
      </MobileEditBlock>
    </div>
  )
}
