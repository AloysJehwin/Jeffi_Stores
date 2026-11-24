import { CardLoading, ConsoleLoading, SkeletonRows, Sk } from '../_components/Skeleton'

const SUBDOMAINS = ['Storefront', 'Admin panel', 'GST invoices', 'Purchase orders', 'Quotations', 'Review forms', 'B2B portal']

export default function Loading() {
  return (
    <ConsoleLoading
      eyebrow="Store"
      title="Domains"
      description="Where your store, admin and service portals live. Buy a new domain for them, or connect one you already have."
    >
      <div className="space-y-6">
        <CardLoading title="Your subdomains">
          <div className="space-y-2">
            {SUBDOMAINS.map((l, i) => (
              <div key={l} className="flex items-start gap-3 px-4 py-2.5 rounded-xl border border-border-default bg-surface text-sm sm:items-center">
                <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0 bg-foreground-muted/50 sm:mt-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-foreground-secondary text-xs font-medium sm:w-28 sm:flex-shrink-0">{l}</span>
                  <Sk className={`h-3 ${i % 2 ? 'w-40' : 'w-52'} max-w-full`} />
                </div>
              </div>
            ))}
          </div>
        </CardLoading>
        <CardLoading title="Buy a domain">
          <SkeletonRows rows={2} cols={3} />
        </CardLoading>
        <CardLoading title="Connect a domain you own">
          <SkeletonRows rows={2} cols={3} />
        </CardLoading>
      </div>
    </ConsoleLoading>
  )
}
