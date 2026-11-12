import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'
import { SplitRow } from '@/components/admin/kit'

/** The Business RFQs overview body (below the period and filter bars) while its data loads. */
export default function RfqsOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['RFQs received', 'Open RFQs', 'Awaiting reply', 'Avg first response', 'Converted to quote', 'Quoted value', 'Won value', 'Rejected']} />
      <LoadingSection title="Needs attention" lines={3} />
      <SplitRow
        scroll="narrow"
        wide={
          <LoadingChart title="RFQs received and converted" />
        }
        narrow={
          <LoadingSection title="All RFQs by status" lines={6} />
        }
      />
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
