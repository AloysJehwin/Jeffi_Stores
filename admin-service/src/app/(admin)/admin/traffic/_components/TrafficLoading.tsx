import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import { PERIOD_PRESETS } from '@/lib/overview/period'
import type { TrafficTab } from '@/lib/traffic/types'

/** The period bar (30 days by default) while the page loads. */
export function PeriodBarLoading() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-control max-w-full gap-0.5 overflow-hidden rounded-lg border border-border-default bg-surface-elevated p-0.5">
        {PERIOD_PRESETS.map(p => (
          <span key={p.id} className={`flex items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium ${p.id === '30d' ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
            {p.label}
          </span>
        ))}
      </div>
      <Sk className="h-control w-32 rounded-lg" />
      <Sk className="h-control w-32 rounded-lg" />
    </div>
  )
}

const Table = ({ title, columns, rows = 5 }: { title: string; columns: string[]; rows?: number }) => (
  <LoadingSection title={title}>
    <LoadingTable columns={columns} rows={rows} bare />
  </LoadingSection>
)

const Bars = ({ title }: { title: string }) => <LoadingSection title={title} lines={5} />

const Share = ({ title }: { title: string }) => (
  <LoadingSection title={title}>
    <div className="space-y-4">
      <Sk className="mx-auto h-[110px] w-[110px] rounded-full" />
      <LoadingLines lines={3} />
    </div>
  </LoadingSection>
)

const BREAKDOWN = (first: string) => [first, 'Sessions', 'Product', 'Cart', 'Checkout', 'Ordered', 'Paid']

/** A traffic tab's body while its data loads; the header, tabs and period bar are already on screen. */
export default function TrafficTabLoading({ tab }: { tab: TrafficTab }) {
  switch (tab) {
    case 'acquisition':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Sessions', 'Online orders', 'Attributed orders', 'Paid sessions', 'Paid revenue', 'Channels']} />
          <Table title="By channel" columns={['Channel', 'Sessions', 'New visitors', 'Conversion', 'Orders', 'Revenue', 'Rev / session']} />
          <LoadingChart title="Paid vs organic sessions by day" />
          <Table title="Drill down" columns={['Source / medium', 'Sessions', 'Conversion', 'Orders', 'Revenue']} />
        </div>
      )
    case 'behaviour':
      return (
        <div className="space-y-5">
          <Table title="Top pages" columns={['Page', 'Views', 'Sessions', 'Entries', 'Exits', 'Exit rate']} />
          <Table title="Landing pages" columns={['Landing page', 'Sessions', 'Bounce', 'Conversion', 'Revenue (tracked)']} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Share title="Views by page type" />
            <Bars title="Session depth (pages per session)" />
          </div>
        </div>
      )
    case 'funnel':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Sessions', 'Ordered', 'Paid', 'Payments started', 'Abandoned carts', 'Abandoned value']} />
          <LoadingSection title="Funnel">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Sk key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </LoadingSection>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Table title="By device" columns={BREAKDOWN('Device')} rows={3} />
            <Table title="By channel" columns={BREAKDOWN('Channel')} rows={3} />
          </div>
        </div>
      )
    case 'products':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Products viewed', 'Product views', 'Cart adds', 'Product orders', 'Revenue', 'Units']} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Bars title="Opportunities: viewed, rarely bought" />
            <Bars title="Promote: converts well, few views" />
            <Bars title="Most wishlisted" />
            <Bars title="Back-in-stock requests waiting" />
          </div>
        </div>
      )
    case 'search':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Searches', 'Unique searchers', 'Zero-result rate', 'Search to purchase']} />
          <Table title="Top search terms" columns={['Term', 'Searches', 'Searchers', 'Avg results', 'Zero-result', 'Clicked', 'Ordered']} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Table title="Zero-result terms: catalogue gaps" columns={['Term', 'Searches', 'Last searched']} />
            <Table title="Results shown, nothing clicked or bought" columns={['Term', 'Searches', 'Avg results', 'Clicked']} />
          </div>
        </div>
      )
    case 'audience':
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {['Device', 'Browser', 'Operating system', 'New vs returning', 'Signed in vs guest'].map(t => (
              <Share key={t} title={t} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Bars title="Top states (from orders)" />
            <Bars title="Top cities (from orders)" />
          </div>
        </div>
      )
    case 'realtime':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Active sessions', 'Pageviews', 'Orders', 'Order value']} />
          <LoadingChart title="Page views per minute" height="h-24" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Bars title="Pages being viewed" />
            <Bars title="Where they came from" />
          </div>
          <Table title="Active sessions" columns={['Current page', 'Source', 'Device', 'Pages', 'Last seen']} />
        </div>
      )
    default:
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Visitors', 'Sessions', 'Pageviews', 'Pages / session', 'Bounce rate', 'Orders (tracked)', 'Conversion', 'Revenue', 'Revenue / session']} />
          <LoadingChart title="Sessions and orders by day" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Bars title="Top sources" />
            <Bars title="Top landing pages" />
            <Bars title="Top products viewed" />
          </div>
        </div>
      )
  }
}
