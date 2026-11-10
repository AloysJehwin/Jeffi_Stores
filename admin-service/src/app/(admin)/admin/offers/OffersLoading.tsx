import { LoadingForm, LoadingLines, LoadingTable, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { LoadingOverviewBody, LoadingRecentChanges, LoadingTableCard } from '../products/_components/loading-parts'

const card = 'rounded-xl border border-border-default bg-surface-elevated'

/** Offers overview body while its data loads. */
export function OffersOverviewLoading() {
  return (
    <LoadingOverviewBody
      kpis={['Live offers', 'Ending in 7 days', 'Products on offer', 'Sales with offer', 'Orders with offer', 'Share of product sales']}
      panel={<LoadingTableCard title="Product offers" columns={['Offer', 'Status', 'Ends', 'Products', 'Sales', 'vs prev']} />}
    />
  )
}

/** Razorpay bank offer cards while they load. */
export function BankOffersLoading({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`space-y-3 p-4 ${card}`}>
          <div className="flex items-start justify-between gap-4">
            <Sk className="h-4 w-1/2" />
            <Sk className="h-5 w-16 rounded-full" />
          </div>
          <Sk className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** The "Offers" tab table before its first rows arrive. */
export function OffersListLoading() {
  return <LoadingTable columns={['Offer', 'Link', 'Products', 'Status']} toolbar={0} />
}

/** Offer view / edit: details and change log beside the products in the offer. */
export function OfferDetailLoading({ footer }: { footer?: boolean }) {
  return (
    <PageLoading back="Offers" actions={footer ? 0 : 1}>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <LoadingForm footer={false} sections={[{ title: 'Offer details', fields: ['Title', 'Launch date', 'End date'], cols: 1 }]} />
          <div className={`p-4 ${card}`}>
            <LoadingLines lines={1} />
          </div>
          <LoadingRecentChanges />
        </div>
        <div className={`min-w-0 space-y-5 p-4 sm:p-5 ${card}`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Products in this offer</h2>
            <Sk className="h-3 w-20" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground-secondary">Add a single product</p>
            <Sk className="h-control rounded-lg" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {['Assign by category', 'Assign by brand'].map(l => (
              <div key={l} className="space-y-2 rounded-lg border border-border-default bg-surface-secondary/40 p-3">
                <p className="text-xs font-medium text-foreground-secondary">{l}</p>
                <Sk className="h-control-sm rounded-lg" />
                <Sk className="h-3 w-2/3" />
              </div>
            ))}
          </div>
          <OfferChipsLoading />
        </div>
      </div>
      {footer && <LoadingForm sections={[]} />}
    </PageLoading>
  )
}

/** The assigned-product chips while they load. */
export function OfferChipsLoading() {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border-default pt-4">
      {['w-28', 'w-36', 'w-24', 'w-32', 'w-40', 'w-28', 'w-20', 'w-36'].map((w, i) => (
        <Sk key={i} className={`h-6 rounded-full ${w}`} />
      ))}
    </div>
  )
}
