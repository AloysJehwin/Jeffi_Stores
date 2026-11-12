import type { ReactNode } from 'react'
import { PageLoading, LoadingKpis, LoadingSection, LoadingLines, Sk } from '@/components/admin/kit/skeleton'
import { SplitRow } from '@/components/admin/kit'

const KPIS = ['Revenue', 'Orders', 'Avg Order Value', 'Customers', 'Gross Margin', 'Units Sold', 'Conversion', 'Repeat Rate']

// kit ChartCard's heading style (not uppercase, unlike Section).
function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  )
}

const donut = (
  <div className="flex items-center gap-4">
    <Sk className="h-[130px] w-[130px] shrink-0 rounded-full" />
    <div className="flex-1">
      <LoadingLines lines={3} />
    </div>
  </div>
)

function Group({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</p>
      <p className="text-xs text-foreground-muted">{hint}</p>
    </div>
  )
}

export default function Loading() {
  return (
    <PageLoading description="Store at a glance, last 30 days" actions={1}>
      <div className="rounded-xl border border-border-default bg-surface-elevated p-2">
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`min-h-[88px] flex-col items-center justify-center gap-2 py-3 ${i > 3 ? 'hidden sm:flex' : 'flex'}`}>
              <Sk className="h-9 w-9 rounded-lg" />
              <Sk className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
      <LoadingKpis labels={KPIS} />
      <SplitRow
        at="xl"
        wide={
          <Chart title="Revenue & Orders">
            <Sk className="h-44 w-full rounded-lg" />
          </Chart>
        }
        narrow={
          <Chart title="Payment Split">{donut}</Chart>
        }
      />
      <LoadingSection title="Order Funnel">
        <Sk className="h-10 w-full rounded-lg" />
      </LoadingSection>
      <Group title="Fulfilment & service" hint="how fast and how cleanly orders move" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <LoadingSection title="Fulfilment Speed" lines={5} />
        <LoadingSection title="Order Quality" lines={5} />
        <LoadingSection title="Service & Reviews" lines={5} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Chart title="Top Categories">
          <LoadingLines lines={5} />
        </Chart>
        <Chart title="Top Brands">
          <LoadingLines lines={5} />
        </Chart>
        <Chart title="Buyer Mix">{donut}</Chart>
      </div>
    </PageLoading>
  )
}
