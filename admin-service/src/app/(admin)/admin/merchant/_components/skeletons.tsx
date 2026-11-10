import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection } from '@/components/admin/kit/skeleton'
import { ChannelPanelLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Merchant Center console tabs; server-safe so loading.tsx shares them.

export const MERCHANT_TAB_LABELS = [
  'Overview',
  'Products & sync',
  'Issues',
  'Performance',
  'Price competitiveness',
  'Price insights',
  'Best sellers',
  'Promotions',
  'Shipping & returns',
  'Account',
  'Alerts',
  'Change history',
  'Job runs',
]

export function MerchantTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'issues':
      return <LoadingSection title="Product issues by type" lines={5} />
    case 'performance':
      return <TableSectionLoading title="Products on Google" columns={['Product', 'Free clicks', 'Ad clicks', 'Impr.', 'CTR', 'Conv.', 'Value']} />
    case 'competitiveness':
      return <TableSectionLoading title="Your price vs the market (benchmark)" columns={['Product', 'Your price', 'Benchmark', 'Gap', 'Clicks 30d']} />
    case 'insights':
      return <TableSectionLoading title="Price insights" columns={['Product', 'Price', 'Suggested', 'Clicks', 'Conversions', 'Margin / unit', 'Confidence']} />
    case 'bestsellers':
      return <TableSectionLoading title="Best sellers in India" columns={['#', 'Prev', 'Product', 'Brand', 'Category', 'Demand', 'You']} />
    case 'promotions':
      return <TableSectionLoading title="Promotions" columns={['Promotion', 'Offer', 'Code', 'Starts', 'Ends', 'Status']} />
    case 'shipping':
      return (
        <div className="space-y-5">
          <LoadingSection title="Shipping services" lines={3} />
          <TableSectionLoading title="Return policies" columns={['Policy', 'Window', 'Return shipping', 'Page']} rows={3} />
        </div>
      )
    case 'account':
      return (
        <div className="space-y-5">
          <LoadingSection title="Account issues" lines={3} />
          <TableSectionLoading title="Programs" columns={['Program', 'State', 'Still needed']} rows={4} />
        </div>
      )
    case 'alerts':
    case 'changes':
    case 'runs':
      return <ChannelPanelLoading tab={tab} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Clicks', 'Impressions', 'CTR', 'Free listing clicks', 'Conversions', 'Products approved']} />
          <LoadingChart title="Clicks by day" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <LoadingSection title="Account">
              <LoadingLines lines={2} />
            </LoadingSection>
            <LoadingSection title="Last product push">
              <LoadingLines lines={2} />
            </LoadingSection>
            <LoadingSection title="Best sellers in India">
              <LoadingLines lines={4} />
            </LoadingSection>
          </div>
        </div>
      )
  }
}
