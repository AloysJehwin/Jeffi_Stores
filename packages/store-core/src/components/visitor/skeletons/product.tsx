import { Sk } from '@/components/admin/kit/skeleton'

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default'

/** /products/[slug]: breadcrumb, gallery and info columns, then the description card. */
export function ProductDetailSkeleton({ portal = 'store' }: { portal?: 'store' | 'business' }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading product">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm" aria-hidden>
            <span className="text-foreground-muted">Home</span>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground-muted">Products</span>
            <span className="text-foreground-muted">/</span>
            <Sk className="h-4 w-20" />
            <span className="text-foreground-muted hidden sm:inline">/</span>
            <Sk className="h-4 w-40 hidden sm:block" />
          </nav>
        </div>
      </div>
      <div className={`container mx-auto px-4 ${portal === 'business' ? 'py-4 sm:py-6 lg:py-8' : 'pt-4 sm:pt-6 lg:pt-8 pb-20'}`}>
        <div className={`${CARD} overflow-hidden mb-4`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 lg:items-start">
            <div>
              <Sk className="w-full aspect-[5/3] rounded-xl mb-4" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Sk key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
              <div className="hidden lg:block mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl border border-border-default bg-surface">
                      <Sk className="w-10 h-10 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <Sk className="h-3.5 w-2/3" />
                        <Sk className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-xl border border-border-default bg-surface-elevated">
                  <p className="text-xs font-semibold text-foreground-secondary mb-2 uppercase tracking-wide">Check Delivery</p>
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground-muted">
                      Enter pincode
                    </div>
                    <span className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg border border-border-default bg-surface text-foreground">
                      Check
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 space-y-2 pt-1">
                  <Sk className="h-7 sm:h-8 w-11/12" />
                  <Sk className="h-7 sm:h-8 w-1/2" />
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-1">
                  <span className="w-10 h-10 rounded-full border border-border-secondary bg-surface-elevated" />
                  <span className="w-10 h-10 rounded-full border border-border-secondary bg-surface-elevated" />
                </div>
              </div>
              <Sk className="h-4 w-36 mb-6" />
              <Sk className="h-10 w-40 mb-2" />
              <Sk className="h-3.5 w-44 mb-6" />
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-sm font-medium text-foreground-secondary">Quantity</span>
                <Sk className="h-4 w-20" />
              </div>
              <Sk className="h-11 w-36 rounded-lg mb-6" />
              <div className="space-y-3">
                <Sk className="h-14 w-full rounded-lg" />
                <Sk className="h-14 w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>
        <div className={`${CARD} p-6 sm:p-8 mb-8`}>
          <h2 className="text-2xl font-bold text-foreground mb-4">Product Description</h2>
          <div className="space-y-2.5">
            {['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-2/3'].map((w, i) => (
              <Sk key={i} className={`h-4 ${w}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
