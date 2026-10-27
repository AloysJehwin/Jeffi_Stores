import { Suspense } from 'react'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { Plus } from 'lucide-react'
import { resolveListTab } from '@/lib/overviews/marketing'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import CampaignsListClient from './CampaignsListClient'
import ScenariosListClient from './scenarios/ScenariosListClient'
import CampaignsOverview from './_components/CampaignsOverview'
import { PageBody, PageHeader, TabAction, TabLinks } from '@/components/admin/kit'
import PageDrafts from '@/components/admin/drafts/PageDrafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const sp = await searchParams
  const tab = sp.tab === 'scenarios' ? 'scenarios' : resolveListTab(sp, [])
  const host = await getHost()
  const base = ap('/admin/campaigns', host)
  const period = new URLSearchParams()
  if (sp.from) period.set('from', sp.from)
  if (sp.to) period.set('to', sp.to)
  const tabs = [
    { id: 'overview' as const, label: 'Overview', href: period.size ? `${base}?${period}` : base },
    { id: 'list' as const, label: 'Campaigns', href: `${base}?tab=list` },
    { id: 'scenarios' as const, label: 'Scenarios', href: `${base}?tab=scenarios` },
  ]
  return (
    <PageBody>
      <PageHeader title="Campaigns" description="Automated marketing campaigns triggered by customer behavior" />
      <div className="mb-5">
        <TabLinks
          tabs={tabs}
          value={tab}
          actions={
            tab === 'overview' ? undefined : (
              <RequireWrite scope="campaigns:write">
                {tab === 'scenarios' ? (
                  <TabAction href={ap('/admin/campaigns/scenarios/new', host)} icon={<Plus className="w-4 h-4" />} label="New scenario" />
                ) : (
                  <TabAction href={ap('/admin/campaigns/new', host)} icon={<Plus className="w-4 h-4" />} label="New Campaign" />
                )}
              </RequireWrite>
            )
          }
        />
      </div>
      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CampaignsOverview />
        </Suspense>
      ) : tab === 'scenarios' ? (
        <ScenariosListClient />
      ) : (
        <>
          <PageDrafts type="campaign" />
          <CampaignsListClient />
        </>
      )}
    </PageBody>
  )
}
