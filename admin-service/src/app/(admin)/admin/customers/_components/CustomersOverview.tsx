'use client'

import Link from 'next/link'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { CUSTOMER_FIELDS, CUSTOMER_SEARCH } from '@/lib/filters/fields/customers'
import {
  AttentionList,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Banner, Kpi, KpiGrid, count, money, pct } from '@/components/admin/channels/ui'
import { delta } from '@/lib/overview/period'
import type { CustomerState, CustomerTotals } from '@/lib/overviews/customers'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  current: CustomerTotals
  previous_totals: CustomerTotals
  top_states: { state: string; orders: number; customers: number; revenue: number }[]
  state: CustomerState
  attention: AttentionItem[]
}

// Customers overview tab; cohorts, LTV and health are on the CRM overview.
export default function CustomersOverview() {
  const [period, setPeriod] = usePeriod()
  // KPIs follow the list's filters; the PeriodBar owns from / to.
  const filters = useFilterQuery(CUSTOMER_FIELDS, { omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/customers/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const c = data?.current
  const p = data?.previous_totals

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters
        entity="customers"
        fields={CUSTOMER_FIELDS}
        search={CUSTOMER_SEARCH}
        period
        noun="Customers"
        tab="overview"
      />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data || !c || !p ? (
        !error && <div className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
      ) : (
        <>
          <KpiGrid>
            <Kpi
              label="New accounts"
              value={count(c.new_accounts)}
              delta={delta(c.new_accounts, p.new_accounts)}
              sub={`${count(data.state.total_accounts)} in total`}
            />
            <Kpi
              label="Active buyers"
              value={count(c.active_buyers)}
              delta={delta(c.active_buyers, p.active_buyers)}
              sub="accounts with a paid order"
            />
            <Kpi
              label="Repeat buyers"
              value={pct(c.repeat_rate)}
              delta={delta(c.repeat_rate, p.repeat_rate)}
              sub={`${count(c.repeat_buyers)} of ${count(c.active_buyers)}`}
            />
            <Kpi
              label="Account orders"
              value={count(c.account_orders)}
              delta={delta(c.account_orders, p.account_orders)}
            />
            <Kpi
              label="Guest orders"
              value={count(c.guest_orders)}
              delta={delta(c.guest_orders, p.guest_orders)}
              sub={`${pct(c.guest_share)} of orders`}
            />
            <Kpi label="Revenue" value={money(c.revenue)} delta={delta(c.revenue, p.revenue)} />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Top states</h3>
                <Link href={ap('/admin/crm')} className="text-xs text-accent-500 hover:underline">
                  Cohorts, lifetime value and health in CRM
                </Link>
              </div>
              {data.top_states.length ? (
                <ul className="divide-y divide-border-default text-sm">
                  {data.top_states.map(s => (
                    <li key={s.state} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-foreground truncate">{s.state}</span>
                      <span className="text-foreground-muted tabular-nums whitespace-nowrap">
                        {count(s.orders)} orders · {money(s.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground-muted">No paid orders in this period.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
