import { LoadingChart, LoadingKpis, LoadingSection, Sk } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingTableCard } from './loading-parts'

const ISSUES = ['No price', 'No image', 'No HSN code', 'No GST rate', 'No cost price', 'No description', 'Out of stock']

/** The products overview body (below the period bar and filters) while its data loads. */
export default function ProductsOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Product sales', 'Units sold', 'Product views', 'Gross margin', 'Catalogue complete', 'Repriced']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingAttention />
        <LoadingChart title="Product sales" height="h-40" />
      </div>
      <LoadingSection title="Catalogue health">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ISSUES.map(l => (
            <div key={l} className="min-w-0 space-y-2 rounded-lg border border-border-default bg-surface p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-foreground-muted">{l}</p>
                <Sk className="h-5 w-8" />
              </div>
              <Sk className="h-3 w-16" />
            </div>
          ))}
        </div>
      </LoadingSection>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingTableCard title="Top sellers" columns={['Product', 'Units', 'Sales', 'vs prev', 'Margin']} />
        <LoadingTableCard title="Most viewed" columns={['Product', 'Views', 'Orders', 'View to order']} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingTableCard title="Never sold" columns={['Product', 'Views', 'Listed']} />
        <LoadingTableCard title="Recently added" columns={['Product', 'Status', 'Added']} />
      </div>
      <LoadingTableCard title="Price changes" columns={['Product', 'From', 'To', 'Change', 'Source', 'When']} />
    </div>
  )
}
