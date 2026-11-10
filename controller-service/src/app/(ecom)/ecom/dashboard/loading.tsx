import { CardLoading, ConsoleLoading, LinesLoading, PillLoading, RowsLoading, TilesLoading } from './_components/Skeleton'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Overview" actions={<PillLoading />}>
      <div className="space-y-6">
        <PillLoading className="w-80 max-w-full" />
        <TilesLoading labels={['Wallet balance', 'Gross GMV', 'Your earnings', 'Platform fees']} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CardLoading title="Store">
            <RowsLoading labels={['Subdomain', 'Created', 'Region']} />
          </CardLoading>
          <CardLoading title="Subscription">
            <RowsLoading labels={['Plan', 'Billing', 'Price', 'Status']} />
            <span className="inline-block mt-4 text-sm font-semibold ecom-accent-text">Manage billing →</span>
          </CardLoading>
          <CardLoading title="Quick links">
            <LinesLoading lines={4} />
          </CardLoading>
        </div>
      </div>
    </ConsoleLoading>
  )
}
