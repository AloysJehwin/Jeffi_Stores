import Link from 'next/link'
import CampaignDetailClient from './CampaignDetailClient'
import CampaignViewClient from './view/CampaignViewClient'
import ReorderIntervalsPanel from './ReorderIntervalsPanel'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignDetailPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const host = await getHost()
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/campaigns', host)} className="text-accent-500 hover:text-accent-600 transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-foreground capitalize">{kind.replace(/_/g, ' ')}</span>
      </div>

      {/* Desktop: the full editor. The block builder / rich editor aren't usable on a phone. */}
      <div className="hidden md:block">
        <CampaignDetailClient kind={kind} />
        {kind === 'replenishment' && <ReorderIntervalsPanel />}
      </div>

      {/* Mobile: read-only view only — editing is desktop-only. */}
      <div className="md:hidden space-y-3">
        <div className="rounded-lg border border-border-default bg-surface-secondary px-4 py-2.5 text-xs text-foreground-muted">
          Editing campaigns is available on a larger screen. This is a read-only view.
        </div>
        <CampaignViewClient kind={kind} />
      </div>
    </div>
  )
}

