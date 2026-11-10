import { PageLoading, LoadingKpis, LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import { istToday, periodLabel, presetPeriod, previousPeriod } from './_lib/period'

const KPIS = ['Total customers', 'New customers', 'Active customers', 'Repeat purchase rate', 'Avg order value', 'Revenue per customer', 'Avg lifetime value', 'At risk + churned']

function Group({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</p>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
    </div>
  )
}

export default function Loading() {
  const period = presetPeriod('30d', istToday())
  return (
    <PageLoading title="CRM" description={`${periodLabel(period)} compared with ${periodLabel(previousPeriod(period))}`} actions={2}>
      <LoadingKpis labels={KPIS} />
      <Group title="Needs attention" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Customer trends" lines={5} />
        <LoadingSection title="Needs Attention" lines={3} />
      </div>
      <Group title="Customers and revenue" hint={periodLabel(period)} />
      <LoadingSection title="New vs returning customers">
        <Sk className="h-48 w-full rounded-lg" />
      </LoadingSection>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <LoadingSection title="Top customers by revenue" className="xl:col-span-3">
          <LoadingTable columns={['Customer', 'Orders', 'Revenue', 'Lifetime', 'Last order', 'Health']} rows={6} bare />
        </LoadingSection>
        <LoadingSection title="Retention by first-order month" lines={6} className="xl:col-span-2" />
      </div>
      <Group title="Health" hint="current" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <LoadingSection title="Health Distribution" lines={3} />
        <LoadingSection title="Top Churn Risks" lines={3} />
        <LoadingSection title="Biggest Drops (7d)" lines={3} />
      </div>
    </PageLoading>
  )
}
