import { LoadingFacts, LoadingSection, PageLoading, Sk } from '@/components/admin/kit/skeleton'

const card = 'rounded-xl border border-border-default bg-surface-elevated'
// Details and Stock & Shipping start open; the rest are collapsed headers.
const OPEN = [
  { title: 'Details', labels: ['Category', 'Brand', 'GST', 'HSN Code', 'Slug'] },
  { title: 'Stock & Shipping', labels: ['Inventory Stock', 'Stock Status', 'Package Type', 'Handling Days', 'Shipping Class'] },
]
const COLLAPSED = ['Pricing & Finance', 'Selling Units', 'Physical & Compliance', 'Lifecycle & Merchandising', 'SEO & Audience']

/** The product view page (image and pricing aside, the collapsed detail cards) while the product loads. */
export default function ProductViewLoading() {
  return (
    <PageLoading back="Products" actions={3}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <div className="min-w-0 space-y-4 lg:order-last">
          <Sk className={`aspect-square ${card}`} />
          <LoadingSection title="Pricing">
            <div className="grid grid-cols-2 gap-4">
              {['MRP', 'Selling Price', 'Ex-GST'].map(l => (
                <div key={l}>
                  <p className="mb-1 text-xs text-foreground-muted">{l}</p>
                  <Sk className="h-5 w-20" />
                </div>
              ))}
            </div>
          </LoadingSection>
        </div>
        <div className="min-w-0 lg:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {OPEN.map(s => (
              <div key={s.title} className={card}>
                <p className="px-5 py-3 text-sm font-semibold uppercase tracking-wide text-foreground">{s.title}</p>
                <div className="border-t border-border-default px-5 py-4">
                  <LoadingFacts labels={s.labels} />
                </div>
              </div>
            ))}
            {COLLAPSED.map(t => (
              <div key={t} className={`px-5 py-3 ${card}`}>
                <p className="text-sm font-semibold uppercase tracking-wide text-foreground">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLoading>
  )
}
