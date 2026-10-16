'use client'

import { ChartCard, TrendLines, GRAN_HINT, num, type Granularity, type Line, type OutflowSegment, type RankedItem, type TrendPoint } from '@/components/admin/kit/charts'
import { DonutSplit, RankedBars } from '@/components/admin/dashboard/Charts'

// Finance-specific chart cards. The generic cards live in components/admin/kit/charts.tsx.
export { KeyedTrendCard, MixDonutCard } from '@/components/admin/kit/charts'
export type { Granularity, OutflowSegment, RankedItem, TrendPoint } from '@/components/admin/kit/charts'

const CASH_IN = 'rgb(16 185 129)'
const CASH_OUT = 'rgb(239 68 68)'
const CASH_NET = 'rgb(59 130 246)'

export function CashflowTrendCard({ data, granularity }: { data: TrendPoint[]; granularity: Granularity }) {
  const lines: Line[] = [
    { key: 'in', label: 'Inflow', color: CASH_IN, points: data.map(d => num(d, 'cash_in')) },
    { key: 'out', label: 'Outflow', color: CASH_OUT, points: data.map(d => num(d, 'cash_out')) },
    { key: 'net', label: 'Net', color: CASH_NET, points: data.map(d => num(d, 'net')) },
  ]
  return (
    <ChartCard title="Cash flow" hint={`Inflow, outflow and net ${GRAN_HINT[granularity]}`}>
      <TrendLines
        months={data.map(d => d.label)}
        lines={lines}
        granularity={granularity}
        ariaLabel="Cash inflow, outflow and net over the period."
      />
    </ChartCard>
  )
}

export function RevenueExpenseCard({ data, granularity }: { data: TrendPoint[]; granularity: Granularity }) {
  const lines: Line[] = [
    { key: 'rev', label: 'Sales', color: CASH_IN, points: data.map(d => num(d, 'revenue')) },
    { key: 'gp', label: 'Gross profit', color: CASH_NET, points: data.map(d => num(d, 'revenue') - num(d, 'cogs')) },
    { key: 'cogs', label: 'Cost of goods', color: 'rgb(234 179 8)', points: data.map(d => num(d, 'cogs')) },
    { key: 'exp', label: 'Supplier payments', color: CASH_OUT, points: data.map(d => num(d, 'supplier_payments')) },
  ]
  return (
    <ChartCard title="Revenue vs expenses" hint={`Sales, cost and supplier payments ${GRAN_HINT[granularity]}`}>
      <TrendLines
        months={data.map(d => d.label)}
        lines={lines}
        granularity={granularity}
        ariaLabel="Sales, gross profit, cost of goods and supplier payments over the period."
      />
    </ChartCard>
  )
}

export function OutflowDonutCard({ segments, total }: { segments: OutflowSegment[]; total: string }) {
  return (
    <ChartCard title="Outflow composition" hint="Where cash went">
      <DonutSplit segments={segments} centerValue={total} centerLabel="Total outflow" />
    </ChartCard>
  )
}

export function TopPayablesCard({ items }: { items: RankedItem[] }) {
  return (
    <ChartCard title="Top payables by supplier" hint="Outstanding, highest first">
      <RankedBars items={items} barClass="bg-red-500/70" />
    </ChartCard>
  )
}

