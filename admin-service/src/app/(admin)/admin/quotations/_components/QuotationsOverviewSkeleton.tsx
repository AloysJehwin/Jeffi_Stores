import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Quotations overview body while its data loads. */
export default function QuotationsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Sent', 'Quoted value', 'Accepted', 'Conversion', 'Won in period', 'Time to accept', 'Open pipeline', 'Expiring this week', 'Average quote', 'Lapsed']} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Expiring soon">
          <LoadingTable bare rows={4} columns={['Quote', 'Customer', 'Left', 'Value']} />
        </LoadingSection>
      </div>
      <LoadingChart title="Quotes over time" />
      <LoadingSection title="Top customers">
        <LoadingTable bare rows={5} columns={['Customer', 'Quotes', 'Quoted', 'Accepted', 'Accepted value', 'Conversion']} />
      </LoadingSection>
    </>
  )
}
