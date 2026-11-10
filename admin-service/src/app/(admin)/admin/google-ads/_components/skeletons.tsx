import { LoadingChart, LoadingFacts, LoadingKpis, LoadingLines, LoadingSection, Sk } from '@/components/admin/kit/skeleton'
import { RangeLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Google Ads console tabs; server-safe so loading.tsx shares them.

export const GOOGLE_ADS_TAB_LABELS = [
  'Overview',
  'Campaigns',
  'Ad groups & ads',
  'Keywords & search terms',
  'Products',
  'Locations',
  'Recommendations',
  'Change history',
  'Conversions',
  'Experiments',
  'Audiences',
  'Sync status',
  'Drafts',
]
const METRICS = ['Cost', 'Impr.', 'Clicks', 'CTR', 'Avg CPC', 'Conv.', 'Conv. value', 'ROAS']
export const UPLOAD_LOG_COLUMNS = ['Queued', 'Order', 'Kind', 'Value', 'Click', 'Ads consent', 'Status', 'Detail']
export const CONVERSION_ACTION_COLUMNS = ['Action', 'Type', 'Category', 'Counting', 'Goal', 'Status']
export const CHANGE_LOG_COLUMNS = ['When', 'What', 'Result', 'By']

/** Preset buttons and the two date fields above the reports. */
export function GoogleAdsRangeLoading() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangeLoading />
      <div className="flex items-center gap-2 text-xs text-foreground-muted">
        <Sk className="h-control w-36 rounded-lg" />
        to
        <Sk className="h-control w-36 rounded-lg" />
      </div>
    </div>
  )
}

/** Overview > Alerts card while its rules load. */
export function AdsAlertsLoading() {
  return (
    <LoadingSection title="Alerts">
      <LoadingLines lines={2} />
    </LoadingSection>
  )
}

export function GoogleAdsTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'campaigns':
      return <TableSectionLoading title="Campaigns" columns={['Campaign', 'Status', 'Type', 'Budget', 'Bid strategy', ...METRICS]} />
    case 'adgroups':
      return (
        <div className="space-y-5">
          <TableSectionLoading title="Ad groups" columns={['Ad group', 'Campaign', 'Status', 'Max CPC', ...METRICS]} />
          <TableSectionLoading title="Ads" columns={['Ad', 'Status', 'Policy', ...METRICS.slice(0, 6)]} />
        </div>
      )
    case 'keywords':
      return (
        <div className="space-y-5">
          <TableSectionLoading title="Search terms" columns={['Search term', 'Matched keyword', ...METRICS]} />
          <TableSectionLoading title="Keywords" columns={['Keyword', 'Match', 'Ad group', 'QS', ...METRICS]} />
        </div>
      )
    case 'products':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Spend on out-of-stock items', 'Spend on loss-making items', 'Flagged items']} />
          <TableSectionLoading title="Shopping items" columns={['Item', 'Stock', 'Price', 'Unit margin', ...METRICS]} />
          <LoadingSection title="Best sellers Google isn't showing" lines={4} />
        </div>
      )
    case 'locations':
      return <TableSectionLoading title="Locations" columns={['Location', ...METRICS]} />
    case 'recommendations':
      return <TableSectionLoading title="Recommendations" columns={['Recommendation', 'Campaign', 'Extra clicks', 'Extra conv.', 'Extra cost', 'Profit effect (ours)', 'Stock']} />
    case 'changes':
      return (
        <div className="space-y-5">
          <TableSectionLoading title="Changes made here" columns={CHANGE_LOG_COLUMNS} rows={4} />
          <TableSectionLoading title="Change history (last 14 days)" columns={['When', 'What', 'Campaign', 'Fields', 'By']} />
        </div>
      )
    case 'conversions':
      return (
        <div className="space-y-5">
          <LoadingSection title="Server-side purchases" lines={5} />
          <LoadingKpis labels={['Uploaded', 'Pending', 'Failed', 'Skipped']} />
          <TableSectionLoading title="Conversion actions in Google Ads" columns={CONVERSION_ACTION_COLUMNS} rows={3} />
          <LoadingSection title="Google Ads import summary" lines={3} />
          <TableSectionLoading title="Upload log" columns={UPLOAD_LOG_COLUMNS} />
        </div>
      )
    case 'experiments':
      return (
        <div className="space-y-5">
          <LoadingSection title="Experiments" lines={3} />
          <LoadingSection title="New experiment" lines={4} />
        </div>
      )
    case 'audiences':
      return <TableSectionLoading title="Customer Match audiences" columns={['List', 'On', 'In segment', 'Uploaded', 'Google size (Search / Display)', 'Match rate', 'Last refresh']} />
    case 'sync':
      return <TableSectionLoading title="Sync history" columns={['Started', 'Mode', 'Status', 'Dates', 'Rows', 'Errors']} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Spend', 'Impressions', 'Clicks', 'CTR', 'Avg CPC', 'Conversions', 'Conv. value', 'ROAS (Google)', 'Cost / conv.', 'Optimization score']} />
          <AdsAlertsLoading />
          <LoadingSection title="Our orders from Google Ads">
            <LoadingKpis labels={['Orders', 'Net revenue', 'True ROAS', 'Gross profit', 'POAS', 'Profit after ads']} />
          </LoadingSection>
          <LoadingChart title="Trend" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <LoadingSection title="By network">
              <Sk className="mx-auto h-36 w-36 rounded-full" />
            </LoadingSection>
            <LoadingSection title="By device">
              <Sk className="mx-auto h-36 w-36 rounded-full" />
            </LoadingSection>
            <LoadingSection title="Account health">
              <LoadingFacts labels={['Optimization score', 'Disapproved ads', 'Ads with policy issues', 'Last sync']} />
            </LoadingSection>
          </div>
        </div>
      )
  }
}
