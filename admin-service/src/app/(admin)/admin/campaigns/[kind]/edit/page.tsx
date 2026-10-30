import { redirect } from 'next/navigation'
import { BackLink } from '@/components/admin/kit'
import CampaignDetailClient from '../CampaignDetailClient'
import ReorderIntervalsPanel from '../ReorderIntervalsPanel'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignEditPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const host = await getHost()

  // Editing ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // campaign with no draft (or an empty-fields marker row) redirects to the view
  // page, where the Edit button creates the seeded draft first.
  const draft = await queryOne<{ fields: Record<string, unknown> | null }>(
    `SELECT fields FROM campaign_drafts WHERE kind = $1`,
    [kind]
  )
  const hasDraft = !!draft && draft.fields != null && Object.keys(draft.fields || {}).length > 0
  if (!hasDraft) {
    redirect(ap(`/admin/campaigns/${kind}/view`, host))
  }

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
