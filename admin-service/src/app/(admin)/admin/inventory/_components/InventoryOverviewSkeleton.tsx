import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

/** The Inventory overview body (below the period and filter bars) while its data loads. */
export default function InventoryOverviewSkeleton() {
  return (
    <>
      <LoadingSection title="Needs attention" lines={3} />
      <div className="space-y-3">
        <LoadingKpis labels={['Stock value at cost', 'At selling price', 'Units on hand', 'SKUs low / out', 'Open POs', 'Overdue POs']} />
        <LoadingKpis labels={['Units sold', 'Cost of goods sold', 'Inventory turnover', 'Days of cover', 'Units in', 'Units out']} />
      </div>
      <LoadingSection title="Reorder suggestions">
        <LoadingTable bare rows={5} columns={['SKU', 'On hand', 'Sold / day', 'Days of cover', 'Lead time', 'Reorder qty', 'Est. cost', 'Supplier']} />
      </LoadingSection>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingChart title="Stock value by category" />
        <LoadingSection title="Top SKUs by stock value" lines={6} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingChart title="Stock movements" />
        <LoadingChart title="Purchase order value trend" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LoadingSection title="Dead stock">
          <LoadingTable bare rows={4} columns={['SKU', 'On hand', 'Value at cost', 'Last sale']} />
        </LoadingSection>
        <LoadingSection title="Expiring soon">
          <LoadingTable bare rows={4} columns={['Batch', 'Qty', 'Expiry', 'Value']} />
        </LoadingSection>
      </div>
      <LoadingSection title="Recent stock movements">
        <LoadingLines lines={5} />
      </LoadingSection>
    </>
  )
}
