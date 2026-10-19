import { BackLink } from '@/components/admin/kit'
import CampaignViewClient from './CampaignViewClient'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignViewPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const host = await getHost()
  // Non-empty fields = a pending draft. Empty marker rows (from the API GET) don't count.
  const draft = await queryOne<{ fields: Record<string, unknown> | null }>(
    `SELECT fields FROM campaign_drafts WHERE kind = $1`,
    [kind]
  )
  const hasDraft = !!draft && draft.fields != null && Object.keys(draft.fields || {}).length > 0
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <BackLink href={ap('/admin/campaigns', host)} label={'Campaigns'} />
      <CampaignViewClient kind={kind} hasDraftInitial={hasDraft} />
    </div>
  )
}
