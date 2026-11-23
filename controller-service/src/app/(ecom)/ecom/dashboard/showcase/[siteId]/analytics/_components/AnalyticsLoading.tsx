import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'
import type { ShowcaseTab } from '@/lib/traffic/showcase-types'

// Each tab's shape while its data loads: real headings and labels, shimmer where numbers go.

const Bars = ({ title }: { title: string }) => <LoadingSection title={title} lines={5} />
const Table = ({ title, columns }: { title: string; columns: string[] }) => (
  <LoadingSection title={title}>
    <LoadingTable columns={columns} rows={5} bare />
  </LoadingSection>
)

export default function AnalyticsTabLoading({ tab }: { tab: ShowcaseTab }) {
  switch (tab) {
    case 'overview':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Visitors', 'Visits', 'Page views', 'Engaged visits', 'Time on page', 'Page seen', 'Enquiries', 'Contact taps', 'Contact rate']} />
          <LoadingSection title="Needs attention" lines={2} />
          <LoadingChart title="Visits and enquiries" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <Bars title="Top sources" />
            <Bars title="Taps on your contacts and links" />
            <Bars title="Top referring sites" />
          </div>
        </div>
      )
    case 'acquisition':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Visits', 'Enquiries', 'Tagged visits', 'Paid visits', 'Enquiries from ads', 'Channels']} />
          <Table title="By channel" columns={['Channel', 'Visits', 'First-time', 'Contact rate', 'Enquiries']} />
          <LoadingChart title="Paid vs organic visits" />
        </div>
      )
    case 'behaviour':
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Bars title="How much of the page they saw" />
            <Bars title="Time on the page" />
          </div>
          <Table title="Landing pages" columns={['Landing page', 'Visits', 'Engaged', 'Contact rate', 'Enquiries']} />
        </div>
      )
    case 'funnel':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Visits', 'Sent an enquiry', 'Tapped to contact', 'Started the form', 'Left the form']} />
          <LoadingSection title="Contact form funnel" lines={6} />
        </div>
      )
    case 'leads':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Enquiries', 'Waiting for a reply', 'Form enquiry rate', 'Contact taps', 'Matched to a visit']} />
          <LoadingChart title="Enquiries" />
          <Table title="Enquiries in this period" columns={['Received', 'From', 'Message', 'Came from', 'Device', 'Status']} />
        </div>
      )
    case 'audience':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {['Device', 'Browser', 'Operating system', 'New vs returning', 'Country', 'Language'].map(t => (
            <Bars key={t} title={t} />
          ))}
        </div>
      )
    case 'realtime':
      return (
        <div className="space-y-5">
          <LoadingKpis labels={['Visitors now', 'Page views', 'Contact taps', 'Enquiries']} />
          <LoadingChart title="Page views per minute" height="h-24" />
          <Table title="Visitors in the last 30 minutes" columns={['Came from', 'Device', 'Seen', 'Did', 'Last seen']} />
        </div>
      )
  }
}
