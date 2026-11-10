import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection } from '@/components/admin/kit/skeleton'
import { ChannelPanelLoading, TableSectionLoading } from '@/components/admin/channels/skeletons'

// Loading shapes for the Amazon console tabs; server-safe so loading.tsx shares them.

export const AMAZON_TAB_LABELS = ['Overview', 'Sales & payouts', 'Orders & stock', 'Listings & push', 'Suppressed', 'Buy Box & pricing', 'Fees & margin', 'Repricer', 'Alerts', 'Change history', 'Job runs']

export function AmazonOrdersLoading() {
  return (
    <div className="space-y-5">
      <LoadingKpis labels={['Amazon orders, 30 days', 'Amazon sales, 30 days', 'Need attention']} />
      <LoadingSection title="Settings" lines={4} />
      <TableSectionLoading title="Amazon orders" columns={['Placed', 'Amazon order', 'Our order', 'Amazon status', 'Fulfilled by', 'Total', 'Items', 'Stock']} />
      <TableSectionLoading title="Stock on Amazon" columns={['Product', 'Your stock', 'Held for Amazon', 'Sent to Amazon', 'Amazon shows', 'Sent']} />
    </div>
  )
}

export function AmazonTabLoading({ tab }: { tab: string }) {
  switch (tab) {
    case 'sales':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Ordered sales', 'Units', 'Sessions', 'Conversion', 'Est. profit, 30 days', 'Lines without cost']} />
          <LoadingChart title="Sales and traffic by day" />
          <TableSectionLoading title="By product (child ASIN)" columns={['Product', 'Sales', 'Units', 'Sessions', 'Unit session %', 'Buy Box %']} />
          <TableSectionLoading title="Settlements (payouts)" columns={['Period', 'Paid', 'Sales', 'Fees', 'Refunds', 'TCS / TDS', 'Payout']} />
        </div>
      )
    case 'orders':
      return <AmazonOrdersLoading />
    case 'suppressed':
      return (
        <TableSectionLoading
          title="Suppressed listings"
          note="Listings Amazon is not showing in search, or that have an error. Fix the issue in your catalogue, then push again from Listings."
          columns={['SKU', 'Title', 'Amazon state', 'Issues']}
        />
      )
    case 'buybox':
      return <TableSectionLoading title="Buy Box and competing offers" columns={['Product', 'Buy Box', 'Your price', 'Buy Box price', 'Lowest', 'Offers', 'Margin now / at Buy Box']} />
    case 'fees':
      return <TableSectionLoading title="Fees and margin per unit" columns={['Product', 'Price', 'Referral', 'Closing', 'Shipping / FBA', 'Fees', 'GST on fees', 'Cost', 'Margin']} />
    case 'repricer':
      return (
        <div className="space-y-5">
          <TableSectionLoading title="Suggested price changes" columns={['Product', 'Now', 'Suggested', 'Floor', 'Why', 'Auto']} />
          <TableSectionLoading title="Rules" columns={['SKU', 'Strategy', 'Min', 'Max', 'Min margin', 'Applies']} />
        </div>
      )
    case 'alerts':
    case 'changes':
    case 'runs':
      return <ChannelPanelLoading tab={tab} />
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Listings', 'Suppressed', 'Buy Box won', 'Buy Box lost', 'Avg margin / unit', 'Selling at a loss']} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <LoadingSection title="Last listing push">
              <LoadingLines lines={1} />
            </LoadingSection>
            <LoadingSection title="Buy Box data">
              <LoadingLines lines={1} />
            </LoadingSection>
          </div>
        </div>
      )
  }
}
