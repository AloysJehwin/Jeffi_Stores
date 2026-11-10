import { LoadingChart, LoadingKpis, LoadingTabs, Sk } from '@/components/admin/kit/skeleton'
import { ChannelPanelLoading, RangeLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Amazon Ads console; server-safe so loading.tsx shares them.

export const AMAZON_ADS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'searchterms', label: 'Search terms' },
  { id: 'products', label: 'Products' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]
const KPI_COLS = ['Spend', 'Sales', 'ACoS', 'Clicks', 'CPC', 'Orders']

export function AmazonAdsTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'campaigns':
      return <TableSectionLoading title="Campaigns" columns={['Campaign', 'State', 'Targeting', 'Daily budget', ...KPI_COLS]} />
    case 'keywords':
      return <TableSectionLoading title="Keywords" columns={['Keyword', 'Match', 'Campaign / ad group', 'State', 'Bid', ...KPI_COLS]} />
    case 'searchterms':
      return <TableSectionLoading title="Search terms" columns={['Search term', 'Campaign / ad group', ...KPI_COLS]} />
    case 'products':
      return <TableSectionLoading title="Advertised products" columns={['Product', 'Stock', ...KPI_COLS, 'Units', 'Profit after ads']} />
    case 'alerts':
    case 'changes':
    case 'runs':
      return <ChannelPanelLoading tab={tab} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Spend', 'Ad sales', 'ACoS', 'TACoS', 'ROAS', 'Orders']} />
          <LoadingChart title="By day" />
        </div>
      )
  }
}

/** Everything under the header: range and account line, tabs, the tab's content. */
export function AmazonAdsBodyLoading({ tab = 'overview' }: { tab?: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <RangeLoading />
        <Sk className="h-3.5 w-48" />
      </div>
      <LoadingTabs tabs={AMAZON_ADS_TABS.map(t => t.label)} active={Math.max(0, AMAZON_ADS_TABS.findIndex(t => t.id === tab))} />
      <AmazonAdsTabLoading tab={tab} />
    </>
  )
}
