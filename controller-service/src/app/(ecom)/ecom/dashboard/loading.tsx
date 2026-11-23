import { CardLoading, ConsoleLoading, LinesLoading, PillLoading, Sk } from './_components/Skeleton'

// A store's Overview and an API workspace's share this shape (four tiles, three cards); what differs shimmers.
export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Overview" actions={<PillLoading />}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {['Wallet balance', '', '', ''].map((label, i) => (
            <div key={i} className="rounded-2xl border border-border-default bg-surface-elevated p-4 sm:p-5">
              {label ? (
                <div className="text-xs text-foreground-muted uppercase tracking-widest mb-2">{label}</div>
              ) : (
                <div className="mb-2 flex h-4 items-center">
                  <Sk className="h-3 w-20" />
                </div>
              )}
              <Sk className="h-7 w-28 sm:h-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1].map(i => (
            <section key={i} className="rounded-2xl border border-border-default bg-surface-elevated p-6">
              <div className="mb-4 flex h-4 items-center">
                <Sk className="h-3 w-24" />
              </div>
              <LinesLoading lines={4} />
            </section>
          ))}
          <CardLoading title="Quick links">
            <LinesLoading lines={4} />
          </CardLoading>
        </div>
      </div>
    </ConsoleLoading>
  )
}
