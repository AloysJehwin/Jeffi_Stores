'use client'

import { AttentionList, OverviewSkeleton, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, count, money, pct } from '@/components/admin/channels/ui'
import { DonutSplit, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import type { CashSaleOverview as Data } from '@/lib/overviews/cash-sale'

const SERIES: SeriesDef[] = [
  { key: 'sales', label: 'Sales', color: 'rgb(16 185 129)', kind: 'area', axis: 'money' },
  { key: 'bills', label: 'Bills', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count' },
]
const MODE_COLORS = ['rgb(16 185 129)', 'rgb(59 130 246)', 'rgb(168 85 247)', 'rgb(234 179 8)', 'rgb(236 72 153)']

export default function CashSaleOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/cash-sale/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cash Sales</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          Counter sales: takings, bills, payment modes, busy hours and best sellers
        </p>
      </div>
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data ? loading && <OverviewSkeleton /> : <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: Data }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const peak = Math.max(1, ...d.byHour.map(h => h.amount))
  const busiest = d.byHour.reduce(
    (a, h) => (h.amount > a.amount ? h : a),
    d.byHour[0] ?? { hour: 0, amount: 0, count: 0 }
  )
  return (
    <>
      <KpiGrid>
        <Kpi
          label="Sales today"
          value={money(d.today.sales)}
          delta={delta(d.today.sales, d.today.lastWeekSales)}
          sub={`${count(d.today.bills)} bills; delta vs same day last week`}
          highlight
        />
        <Kpi label="Sales in period" value={money(c.sales)} delta={delta(c.sales, p.sales)} />
        <Kpi label="Bills" value={count(c.bills)} delta={delta(c.bills, p.bills)} />
        <Kpi label="Average bill" value={money(c.avgBill)} delta={delta(c.avgBill, p.avgBill)} />
        <Kpi
          label="Per trading day"
          value={money(c.perDay)}
          delta={delta(c.perDay, p.perDay)}
          sub={`${count(c.tradingDays)} days with sales`}
        />
        <Kpi
          label="Units sold"
          value={count(d.units.current.units)}
          delta={delta(d.units.current.units, d.units.previous.units)}
        />
        <Kpi label="GST collected" value={money(c.gst)} delta={delta(c.gst, p.gst)} />
        <Kpi
          label="Cancelled"
          value={count(c.cancelled)}
          invert
          delta={delta(c.cancelled, p.cancelled)}
          sub={`${money(c.cancelledValue)}, ${pct(c.cancelRate)} of bills`}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AttentionList items={d.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
        <Section title="By payment mode">
          {d.byMode.length ? (
            <DonutSplit
              segments={d.byMode.map((m, i) => ({
                label: `${m.label} (${count(m.count)})`,
                value: m.amount,
                color: MODE_COLORS[i % MODE_COLORS.length],
              }))}
              centerLabel="Sales"
              centerValue={money(c.sales)}
            />
          ) : (
            <p className="text-sm text-foreground-muted">No sales in this period.</p>
          )}
        </Section>
      </div>

      <Section title="Sales over time">
        <TrendChart points={d.series} bucket={d.bucket} series={SERIES} ariaLabel="Cash sales over time" />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="By hour of day (IST)">
          <div className="flex items-end gap-0.5 h-32" role="img" aria-label="Sales by hour of day">
            {d.byHour.map(h => (
              <div
                key={h.hour}
                className="flex-1 h-full flex flex-col justify-end"
                title={`${String(h.hour).padStart(2, '0')}:00 - ${money(h.amount)}, ${h.count} bills`}
              >
                <div
                  className="bg-accent-500/80 rounded-t"
                  style={{ height: `${h.amount ? Math.max(2, (h.amount / peak) * 100) : 0}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-foreground-muted mt-1 tabular-nums">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          {busiest.amount > 0 && (
            <p className="text-xs text-foreground-muted mt-2">
              Busiest hour: {String(busiest.hour).padStart(2, '0')}:00 with {money(busiest.amount)} across{' '}
              {count(busiest.count)} bills
            </p>
          )}
        </Section>
        <Section title="Top items">
          <Table
            rows={d.topItems}
            rowKey={r => `${r.productId}-${r.name}`}
            empty="No items sold in this period"
            cols={[
              { key: 'name', label: 'Item', render: r => <span className="line-clamp-2">{r.name}</span> },
              { key: 'units', label: 'Units', num: true, sort: r => r.units, render: r => count(r.units) },
              { key: 'bills', label: 'Bills', num: true, sort: r => r.bills, render: r => count(r.bills) },
              { key: 'amount', label: 'Sales', num: true, sort: r => r.amount, render: r => money(r.amount) },
            ]}
          />
        </Section>
      </div>
      <p className="text-[11px] text-foreground-muted">
        Cash sales do not record the cashier, so there is no per-cashier split.
      </p>
    </>
  )
}
