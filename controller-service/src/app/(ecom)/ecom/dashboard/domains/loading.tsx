import { CardLoading, ConsoleLoading, SkeletonRows, Sk } from '../_components/Skeleton'

const SUBDOMAINS = ['Storefront', 'Admin panel', 'GST invoices', 'Purchase orders', 'Quotations', 'Review forms', 'B2B portal']

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Store" title="Domains" description="Where your store, admin and service portals live.">
      <div className="space-y-6">
        <CardLoading title="Your subdomains">
          <div className="space-y-2">
            {SUBDOMAINS.map((l, i) => (
              <div key={l} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border-default bg-surface text-sm">
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-foreground-muted/50" />
                <span className="text-foreground-secondary w-20 sm:w-28 flex-shrink-0 text-xs font-medium">{l}</span>
                <Sk className={`h-3 ${i % 2 ? 'w-40' : 'w-52'} max-w-full`} />
              </div>
            ))}
          </div>
        </CardLoading>
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
          <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-3">Custom domains</div>
          <SkeletonRows rows={2} cols={3} />
        </div>
      </div>
    </ConsoleLoading>
  )
}
