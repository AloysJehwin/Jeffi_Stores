import { Suspense } from 'react'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { resolveListTab } from '@/lib/overviews/marketing'
import OverviewTabs from '../coupons/_components/OverviewTabs'
import CampaignsListClient from './CampaignsListClient'
import CampaignsOverview from './_components/CampaignsOverview'
import { PageBody, PageHeader } from '@/components/admin/kit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const sp = await searchParams
  const tab = resolveListTab(sp, [])
  const host = await getHost()
  return (
    <PageBody>
      <PageHeader title="Campaigns" description="Automated marketing campaigns triggered by customer behavior" />
      <OverviewTabs basePath={ap('/admin/campaigns', host)} active={tab} sp={sp} listLabel="Campaigns" />
      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CampaignsOverview />
        </Suspense>
      ) : (
        <CampaignsListClient />
      )}
    </PageBody>
  )
}
