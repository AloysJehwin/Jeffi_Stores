import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Business RFQs overview body (below the period and filter bars) while its data loads. */
export default function RfqsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['RFQs received', 'Open RFQs', 'Awaiting reply', 'Avg first response', 'Converted to quote', 'Quoted value', 'Won value', 'Rejected']} />
      <LoadingSection title="Needs attention" lines={3} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingChart title="RFQs received and converted" />
        </div>
        <LoadingSection title="All RFQs by status" lines={6} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSection title="Top B2B customers">
          <LoadingTable bare rows={5} columns={['Customer', 'RFQs', 'Converted', 'Quoted', 'Won']} />
        </LoadingSection>
        <LoadingSection title="Waiting for a reply">
          <LoadingTable bare rows={5} columns={['RFQ', 'Company', 'Status', 'Waiting']} />
        </LoadingSection>
      </div>
    </>
  )
}
