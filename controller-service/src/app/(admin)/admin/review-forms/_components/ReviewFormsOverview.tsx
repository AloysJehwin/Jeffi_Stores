'use client'

import Link from 'next/link'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Badge, Banner, Kpi, KpiGrid, Section, Table, count, pct } from '@/components/admin/channels/ui'
import { delta } from '@/lib/overview/period'
import type { ReviewFormState, ReviewFormTotals } from '@/lib/overviews/review-forms'
import { ap } from '@/lib/shared/admin-path'

interface Form {
  id: string
  title: string
  active: boolean
  coupon_code: string | null
  all_time: number
  submissions: number
  pending: number
  approved: number
}
interface Data {
  current: ReviewFormTotals
  previous_totals: ReviewFormTotals
  forms: Form[]
  state: ReviewFormState
  attention: AttentionItem[]
}

export default function ReviewFormsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/review-forms/overview?from=${period.from}&to=${period.to}`
  )
  const c = data?.current
  const p = data?.previous_totals

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data || !c || !p ? (
        !error && <OverviewSkeleton />
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Active forms" value={count(data.state.active)} sub={`${count(data.state.forms)} in total`} />
            <Kpi
              label="Submissions"
              value={count(c.submissions)}
              delta={delta(c.submissions, p.submissions)}
              highlight
            />
            <Kpi
              label="Requests sent"
              value={count(c.requests)}
              delta={delta(c.requests, p.requests)}
              sub="review-form messages"
            />
            <Kpi
              label="Conversion"
              value={pct(c.conversion)}
              delta={delta(c.conversion, p.conversion)}
              sub="submissions per request"
            />
            <Kpi
              label="Approved"
              value={count(c.approved)}
              delta={delta(c.approved, p.approved)}
              sub={`${pct(c.approval_rate)} approval rate`}
            />
            <Kpi
              label="Coupons issued"
              value={count(c.coupons)}
              delta={delta(c.coupons, p.coupons)}
              sub={`${count(data.state.pending)} pending review`}
            />
          </KpiGrid>

          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />

          <Section
            title="Forms"
            action={
              <Link href={ap('/admin/review-forms?tab=list')} className="text-xs text-accent-500 hover:underline">
                Manage forms
              </Link>
            }
          >
            <Table
              rows={data.forms}
              rowKey={r => r.id}
              empty="No forms yet."
              cols={[
                {
                  key: 'title',
                  label: 'Form',
                  render: r => (
                    <span className="inline-flex items-center gap-2">
                      <Link
                        href={ap(`/admin/review-forms/${r.id}/submissions`)}
                        className="text-accent-500 hover:underline"
                      >
                        {r.title}
                      </Link>
                      {!r.active && <Badge>Off</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'coupon',
                  label: 'Reward',
                  render: r =>
                    r.coupon_code ? (
                      <span className="font-mono text-xs">{r.coupon_code}</span>
                    ) : (
                      <Badge tone="amber">None</Badge>
                    ),
                },
                {
                  key: 'subs',
                  label: 'Submissions',
                  num: true,
                  render: r => count(r.submissions),
                  sort: r => r.submissions,
                },
                {
                  key: 'pending',
                  label: 'Pending',
                  num: true,
                  render: r => (r.pending ? <span className="text-amber-600">{count(r.pending)}</span> : '-'),
                  sort: r => r.pending,
                },
                {
                  key: 'approved',
                  label: 'Approved',
                  num: true,
                  render: r => count(r.approved),
                  sort: r => r.approved,
                },
                { key: 'all', label: 'All time', num: true, render: r => count(r.all_time), sort: r => r.all_time },
              ]}
            />
          </Section>
        </>
      )}
    </div>
  )
}
