import { Suspense } from 'react'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { resolveListTab } from '@/lib/overviews/marketing'
import OverviewTabs from '../coupons/_components/OverviewTabs'
import CampaignsListClient from './CampaignsListClient'
import CampaignsOverview from './_components/CampaignsOverview'

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
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Campaigns</h1>
          <p className="text-foreground-secondary mt-1 text-sm">
            Automated marketing campaigns triggered by customer behavior
          </p>
        </div>
      </div>
      <OverviewTabs basePath={ap('/admin/campaigns', host)} active={tab} sp={sp} listLabel="Campaigns" />
      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CampaignsOverview />
        </Suspense>
      ) : (
        <CampaignsListClient />
      )}
    </div>
  )
}
