'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PO_ALIASES, PO_FIELDS, PO_SEARCH } from '@jeffi/list-filters/fields'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { MAX_SPAN_DAYS } from '@/lib/overview/period'
import {
  usePeriod,
  PeriodBar,
  useOverviewData,
  AttentionList,
  OverviewSkeleton,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, Badge, money, count, btnGhost } from '@/components/admin/channels/ui'
import { TrendChart, DonutSplit, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import type { OpenPo, ReorderGroup } from '@/lib/overviews/purchase-orders'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  kpis: OverviewKpi[]
  bucket: 'day' | 'week' | 'month'
  series: { label: string; raised: number; received: number }[]
  by_status: { status: string; count: number; value: number }[]
  top_suppliers: { id: string; name: string; value: number; pos: number }[]
  overdue: OpenPo[]
  partial: OpenPo[]
  reorder: ReorderGroup[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'raised', label: 'POs raised', color: 'rgb(59 130 246)', kind: 'bar', axis: 'money', on: true },
  { key: 'received', label: 'Received', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
]

const STATUS_COLOR: Record<string, string> = {
  draft: 'rgb(148 163 184)',
  sent: 'rgb(59 130 246)',
  partial: 'rgb(234 179 8)',
}

const poHref = (id: string) => ap(`/admin/purchase-orders?tab=orders&po=${id}`)

function draftHref(g: ReorderGroup) {
  const lines = g.lines
    .map(l => `${l.product_id}:${l.variant_id || ''}:${l.sub_variant_id || ''}:${l.suggestedQty}`)
    .join(',')
  const q = new URLSearchParams({ lines })
  if (g.supplier_id) q.set('supplier', g.supplier_id)
  return ap(`/admin/purchase-orders/new?${q}`)
}

export default function PurchaseOrdersOverview() {
  const [period, setPeriod] = usePeriod()
  const sp = useSearchParams()
  // KPIs and charts follow the list's filters; the PeriodBar owns from / to (the order date).
  const filters = useFilterQuery(PO_FIELDS, { aliases: PO_ALIASES, omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/purchase-orders/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const clamped = !!sp.get('from') && sp.get('from') !== period.from

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters
        entity="purchase-orders"
        fields={PO_FIELDS}
        aliases={PO_ALIASES}
        search={PO_SEARCH}
        period
        noun="Purchase orders"
        tab="overview"
      />
      {clamped && (
        <p className="text-xs text-foreground-muted">
          The overview covers at most {MAX_SPAN_DAYS} days: showing {period.from} to {period.to}.
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading || !data ? (
        !error && <OverviewSkeleton />
      ) : (
        <>
          <KpiGrid>
            {data.kpis.map(k => (
              <Kpi
                key={k.key}
                label={k.label}
                value={formatKpi(k.value, k.format)}
                delta={k.delta}
                invert={k.invert}
                sub={k.sub}
              />
            ))}
          </KpiGrid>
          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
          <Section title="Raised vs received">
            <TrendChart
              points={data.series}
              bucket={data.bucket}
              series={SERIES}
              ariaLabel="PO value raised and goods received"
            />
          </Section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Open POs by status">
              {data.by_status.every(s => !s.count) ? (
                <p className="text-sm text-foreground-muted">No open purchase orders.</p>
              ) : (
                <DonutSplit
                  segments={data.by_status.map(s => ({
                    label: `${s.status[0].toUpperCase()}${s.status.slice(1)} (${count(s.count)}) ${money(s.value)}`,
                    value: s.value,
                    color: STATUS_COLOR[s.status],
                  }))}
                  centerValue={money(data.by_status.reduce((a, s) => a + s.value, 0))}
                  centerLabel="open value"
                />
              )}
            </Section>
            <Section title="Top suppliers by spend">
              <RankedBars
                items={data.top_suppliers.map(s => ({
                  name: s.name,
                  value: s.value,
                  sub: `${money(s.value)} · ${count(s.pos)} PO${s.pos === 1 ? '' : 's'}`,
                }))}
              />
            </Section>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Overdue deliveries">
              {data.overdue.length === 0 ? (
                <p className="text-sm text-foreground-muted">No open PO is past its expected date.</p>
              ) : (
                <ul className="divide-y divide-border-default">
                  {data.overdue.map(p => (
                    <li key={p.id}>
                      <Link
                        href={poHref(p.id)}
                        className="flex items-start justify-between gap-2 py-2 text-sm hover:text-accent-500"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-xs">{p.po_number}</span>
                          <span className="block text-xs text-foreground-muted truncate">
                            {p.supplier_name || '-'} · {money(p.total_amount)}
                          </span>
                        </span>
                        <Badge tone={p.days_late > 7 ? 'red' : 'amber'}>{p.days_late} d late</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Partially received">
              {data.partial.length === 0 ? (
                <p className="text-sm text-foreground-muted">No partly received PO.</p>
              ) : (
                <ul className="divide-y divide-border-default">
                  {data.partial.map(p => {
                    const pct = Math.round(p.received_share * 100)
                    return (
                      <li key={p.id}>
                        <Link href={poHref(p.id)} className="block py-2 text-sm hover:text-accent-500">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">{p.po_number}</span>
                            <span className="text-xs text-foreground-muted">{pct}% received</span>
                          </span>
                          <span className="block text-xs text-foreground-muted truncate">
                            {p.supplier_name || '-'}
                            {p.last_grn ? ` · last delivery ${p.last_grn}` : ''}
                          </span>
                          <span className="mt-1 block h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                            <span className="block h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>
          </div>
          <Section title="Reorder suggestions">
            {data.reorder.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Nothing is running low against its sales rate, counting stock already on order.
              </p>
            ) : (
              <div className="space-y-5">
                <p className="text-xs text-foreground-muted">
                  Items with less cover than their supplier lead time (or 14 days), net of quantity due on open POs.
                  Draft a PO per supplier with the suggested quantities; you can edit everything before saving.
                </p>
                {data.reorder.map(g => (
                  <div key={g.supplier_id || 'none'} className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">
                        {g.supplier_name || 'No supplier on record'}
                        <span className="ml-2 text-xs font-normal text-foreground-muted">
                          {count(g.lines.length)} item{g.lines.length === 1 ? '' : 's'}
                          {g.value > 0 ? ` · approx ${money(g.value)} ex GST` : ''}
                        </span>
                      </p>
                      <RequireWrite scope="inventory">
                        <Link href={draftHref(g)} className={btnGhost}>
                          Draft PO
                        </Link>
                      </RequireWrite>
                    </div>
                    <Table
                      rows={g.lines}
                      rowKey={l => `${l.product_id}:${l.variant_id || ''}:${l.sub_variant_id || ''}`}
                      pageSize={10}
                      cols={[
                        {
                          key: 'item',
                          label: 'Item',
                          render: l => (
                            <span>
                              {l.name}
                              {l.leaf_name && <span className="text-foreground-muted"> / {l.leaf_name}</span>}
                              {l.sku && <span className="block font-mono text-xs text-foreground-muted">{l.sku}</span>}
                            </span>
                          ),
                        },
                        { key: 'qty', label: 'On hand', num: true, render: l => count(l.qty), sort: l => l.qty },
                        { key: 'in', label: 'On order', num: true, render: l => count(l.inbound), sort: l => l.inbound },
                        {
                          key: 'cover',
                          label: 'Cover',
                          num: true,
                          render: l => `${l.daysOfCover.toFixed(0)} d`,
                          sort: l => l.daysOfCover,
                        },
                        {
                          key: 'sugg',
                          label: 'Suggested',
                          num: true,
                          render: l => count(l.suggestedQty),
                          sort: l => l.suggestedQty,
                        },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
