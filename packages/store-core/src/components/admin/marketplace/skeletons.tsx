import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, LoadingTable, LoadingToolbar, LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { ChannelPanelLoading, RangeLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Myntra / AJIO consoles and their ads consoles. Server-safe (no client
// imports), so the routes' loading.tsx and the client panels share them.

type Channel = 'myntra' | 'ajio'
type AdsChannel = 'myntra_ads' | 'ajio_ads'

export const MARKETPLACE_INFO: Record<Channel, { title: string; description: string }> = {
  myntra: { title: 'Myntra', description: 'Orders pushed by Myntra, listings, stock, returns and settlements' },
  ajio: { title: 'AJIO', description: 'Orders pushed by AJIO, purchase orders, listings, stock, returns and settlements' },
}
export const MARKETPLACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'returns', label: 'Returns' },
  { id: 'listings', label: 'Listings' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Changes' },
  { id: 'runs', label: 'Runs' },
]
export const ADS_TITLE: Record<AdsChannel, string> = { myntra_ads: 'Myntra Ads', ajio_ads: 'AJIO Ads' }
export const ADS_DESCRIPTION = 'Spend, sales, campaigns and products from the reports you import'
export const ADS_TABS = ['Overview', 'Campaigns', 'Products', 'Import', 'Alerts']
export const IMPORT_HISTORY_COLUMNS = ['Imported', 'File', 'Kind', 'Period', 'Rows', 'Replaced', 'Spend', 'By']

/** Overview tab: KPIs and the recent pushes (MarketplaceOverview). */
export function MarketplaceOverviewLoading() {
  return (
    <div className="space-y-5">
      <LoadingKpis labels={['Orders today', 'Orders, 7 days', 'Awaiting accept', 'Breaching SLA', 'RTD pending', 'Returns open']} />
      <LoadingSection title="Recent pushes">
        <Sk className="mb-3 h-3 w-64" />
        <LoadingTable bare columns={['Received', 'Event', 'Order', 'Status']} rows={5} />
      </LoadingSection>
    </div>
  )
}

function ConnectionLoading() {
  return (
    <LoadingSection title="Connection">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {['Mode', 'Last event', 'Push URL'].map((l, i) => (
          <div key={l} className={`min-w-0 ${i === 2 ? 'sm:col-span-2' : ''}`}>
            <dt className="text-xs text-foreground-muted">{l}</dt>
            <dd className="mt-1">
              <Sk className={`h-4 ${i === 2 ? 'w-80 max-w-full' : 'w-24'}`} />
            </dd>
          </div>
        ))}
      </dl>
    </LoadingSection>
  )
}

export function InventoryLoading() {
  return (
    <div className="space-y-5">
      <LoadingKpis labels={['Listings with stock', 'Waiting to push', 'Push errors', 'Price differs']} />
      <TableSectionLoading title="Stock on the marketplace" columns={['Listing', 'Our stock', 'Reserved', 'Pushed / to push', 'Last push', 'Price']} />
      <LoadingSection title="Safety buffer" lines={2} />
    </div>
  )
}

export function SettlementsLoading() {
  return (
    <div className="space-y-5">
      <RangeLoading presets={[30, 90, 180, 365]} active={90} />
      <LoadingKpis labels={['Settled to bank', 'Commission + fees', 'TCS / TDS', 'Receivable']} />
      <TableSectionLoading title="Payouts" columns={['Settled', 'Reference', 'Sales', 'Commission + fees', 'TCS / TDS', 'Refunds', 'Matched']} />
      <TableSectionLoading title="Delivered, not settled" columns={['Order', 'Marketplace order', 'Value', 'Delivered']} rows={4} />
    </div>
  )
}

export function ListingsLoading() {
  return (
    <LoadingSection title="Listings">
      <div className="space-y-3">
        <Sk className="h-3 w-3/4" />
        <LoadingToolbar filters={1} />
        <div className="divide-y divide-border-default/60 border-y border-border-default/60">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Sk className="h-10 w-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Sk className="h-3.5 w-1/2" />
                <Sk className="h-3 w-1/3" />
              </div>
              <Sk className="hidden h-control w-32 rounded-lg sm:block" />
              <Sk className="hidden h-control w-32 rounded-lg sm:block" />
            </div>
          ))}
        </div>
      </div>
    </LoadingSection>
  )
}

/** A tab's content before its data arrives. Orders and Returns are their tabs' own lists. */
export function MarketplaceTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'orders':
      return (
        <div className="space-y-4">
          <div className="flex gap-1 overflow-hidden pb-1">
            {['New', 'To pack', 'Ready to dispatch', 'Shipped', 'Cancelled / returned'].map((b, i) => (
              <span key={b} className={`control-sm shrink-0 border ${i === 0 ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400' : 'border-border-default text-foreground-muted'}`}>
                {b}
              </span>
            ))}
          </div>
          <LoadingTable toolbar={0} columns={['Order', 'Items', 'Amount', 'Accept by', 'Status']} />
        </div>
      )
    case 'returns':
      return <LoadingTable toolbar={0} columns={['Return', 'Order', 'Type', 'Reason', 'Refund', 'Status', 'Stock', 'Updated']} />
    case 'listings':
      return <ListingsLoading />
    case 'inventory':
      return <InventoryLoading />
    case 'settlements':
      return <SettlementsLoading />
    case 'alerts':
    case 'changes':
    case 'runs':
      return <ChannelPanelLoading tab={tab} />
    default:
      return (
        <div className="space-y-5">
          <MarketplaceOverviewLoading />
          <ConnectionLoading />
        </div>
      )
  }
}

/** Everything under the console header: tabs and the active tab's content. */
export function MarketplaceBodyLoading({ tab = 'overview' }: { tab?: string }) {
  return (
    <>
      <LoadingTabs tabs={MARKETPLACE_TABS.map(t => t.label)} active={Math.max(0, MARKETPLACE_TABS.findIndex(t => t.id === tab))} />
      <MarketplaceTabLoading tab={tab} />
    </>
  )
}

export function MarketplaceLoadingPage({ channel }: { channel: Channel }) {
  const info = MARKETPLACE_INFO[channel]
  return (
    <PageLoading title={info.title} description={info.description} actions={1}>
      <MarketplaceBodyLoading />
    </PageLoading>
  )
}

/** The ads console's tab content before its data arrives. */
export function MarketplaceAdsTabLoading({ tab }: { tab: string }) {
  const kpiCols = ['Spend', 'Sales', 'ACoS', 'Clicks', 'CTR', 'CPC', 'Orders', 'Units']
  switch (tab) {
    case 'campaigns':
      return <TableSectionLoading title="Campaigns" columns={['Campaign', 'Ad groups', ...kpiCols]} />
    case 'products':
      return <TableSectionLoading title="Advertised products" columns={['Product', 'Stock', ...kpiCols, 'Profit after ads']} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Spend', 'Ad sales', 'ACoS', 'ROAS', 'CTR', 'CPC', 'Orders']} />
          <LoadingChart title="By day" />
          <LoadingLines lines={1} />
        </div>
      )
  }
}

export function MarketplaceAdsLoadingPage({ channel }: { channel: AdsChannel }) {
  return (
    <PageLoading title={ADS_TITLE[channel]} description={ADS_DESCRIPTION} actions={1}>
      <RangeLoading />
      <LoadingTabs tabs={ADS_TABS} />
      <MarketplaceAdsTabLoading tab="overview" />
    </PageLoading>
  )
}
