import { LoadingChart, LoadingKpis, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Invoices overview body while its data loads. */
export default function InvoicesOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Invoiced value', 'Invoices', 'GST collected', 'Average invoice', 'Paid', 'Unpaid', 'Outstanding (all)', 'E-invoice coverage', 'Refunded', 'Voided']} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Needs attention" lines={3} />
        <LoadingSection title="Unpaid by age" lines={4} />
      </div>
      <LoadingChart title="Invoiced over time" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <LoadingSection title="Paid vs unpaid" lines={3} />
        <LoadingSection title="By channel" lines={3} />
        <LoadingSection title="By GST rate">
          <LoadingTable bare rows={4} columns={['Rate', 'Taxable', 'GST']} />
        </LoadingSection>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Oldest unpaid invoices">
          <LoadingTable bare rows={5} columns={['Invoice', 'Customer', 'Age', 'Amount']} />
        </LoadingSection>
        <LoadingSection title="Top customers">
          <LoadingTable bare rows={5} columns={['Customer', 'Invoices', 'Value', 'Unpaid']} />
        </LoadingSection>
      </div>
    </>
  )
}
