import { PageLoading, Sk } from '@/components/admin/kit/skeleton'

const card = 'rounded-xl border border-border-default bg-surface-elevated'
const COLLAPSED = ['Details', 'Stock & Shipping', 'Pricing & Finance', 'Selling Units', 'Physical & Compliance', 'Lifecycle & Merchandising', 'SEO & Audience']

/** The product view page (image, pricing, the collapsed detail cards) while the product loads. */
export default function ProductViewLoading() {
  return (
    <PageLoading back="Products" actions={3}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Sk className={`aspect-square ${card}`} />
        <div className="space-y-4 lg:col-span-2">
          <div className={`space-y-3 p-4 ${card}`}>
            <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Pricing</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {['MRP', 'Selling Price', 'Ex-GST'].map(l => (
                <div key={l}>
                  <p className="mb-1 text-xs text-foreground-secondary">{l}</p>
                  <Sk className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {COLLAPSED.map(t => (
              <div key={t} className={`px-4 py-3 ${card}`}>
                <p className="text-sm font-semibold uppercase tracking-wide text-foreground">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLoading>
  )
}
