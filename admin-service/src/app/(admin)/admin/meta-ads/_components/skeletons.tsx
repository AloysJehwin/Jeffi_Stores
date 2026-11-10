import { LoadingChart, LoadingKpis, LoadingSection, LoadingTabs, Sk } from '@/components/admin/kit/skeleton'
import { ChannelPanelLoading, RangeLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Meta Ads console; server-safe so loading.tsx shares them.

export const META_ADS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adsets', label: 'Ad sets' },
  { id: 'ads', label: 'Ads' },
  { id: 'breakdowns', label: 'Audience & placement' },
  { id: 'capi', label: 'Conversions API' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]
const KPI_COLS = ['Spend', 'Purchases', 'Value', 'ROAS', 'Cost / purchase', 'Link clicks', 'CTR']
const BREAKDOWNS = ['Age and gender', 'Placement', 'Region']

export function MetaAdsTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'campaigns':
    case 'adsets':
    case 'ads':
      return (
        <TableSectionLoading
          title={META_ADS_TABS.find(t => t.id === tab)!.label}
          columns={['Name', 'Status', ...(tab === 'ads' ? [] : ['Daily budget']), ...KPI_COLS]}
        />
      )
    case 'breakdowns':
      return (
        <div className="space-y-5">
          {BREAKDOWNS.map(b => (
            <TableSectionLoading key={b} title={`${b} (last 30 days)`} columns={[b, ...KPI_COLS]} rows={4} />
          ))}
        </div>
      )
    case 'capi':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Sent, 30 days', 'Failed', 'Not sent', 'With email or phone', 'With a Meta click id', 'Last sent']} />
          <LoadingSection title="Setup" lines={3} />
          <TableSectionLoading title="Recent events" columns={['When', 'Order', 'Value', 'Matched on', 'Status']} />
        </div>
      )
    case 'alerts':
    case 'changes':
    case 'runs':
      return <ChannelPanelLoading tab={tab} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Spend', 'Purchases (Meta)', 'ROAS (Meta)', 'True ROAS', 'Reach', 'Cost / purchase']} />
          <LoadingChart title="By day" />
        </div>
      )
  }
}

/** Everything under the header: range and ad account line, tabs, the tab's content. */
export function MetaAdsBodyLoading({ tab = 'overview' }: { tab?: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <RangeLoading />
        <Sk className="h-3.5 w-56" />
      </div>
      <LoadingTabs tabs={META_ADS_TABS.map(t => t.label)} active={Math.max(0, META_ADS_TABS.findIndex(t => t.id === tab))} />
      <MetaAdsTabLoading tab={tab} />
    </>
  )
}
