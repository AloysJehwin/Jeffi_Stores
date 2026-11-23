'use client'

import { Empty, Kpi, KpiGrid, Section, Table, change, count, pct, type Col } from '@/components/admin/channels/ui'
import { HBars } from '@/components/admin/traffic/charts'
import type { ShowcaseFunnel, ShowcaseFunnelRow } from '@/lib/traffic/showcase-types'
import { Note, PointChange, rateText, ratio, targetLabel } from './shared'

const COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#f97316', '#22c55e']

export default function FunnelTab({ data }: { data: ShowcaseFunnel }) {
  const first = data.steps[0]
  if (!first || first.count === 0) return <Empty msg="No visits in this period yet, so there is no funnel to show." />
  const lead = data.steps.find(s => s.key === 'lead')
  const started = data.steps.find(s => s.key === 'formStarted')

  const bdCols = (label: string): Col<ShowcaseFunnelRow>[] => [
    { key: 'key', label, render: r => r.key, sort: r => r.key },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'engaged', label: 'Engaged', num: true, sort: r => ratio(r.engaged, r.sessions) ?? -1, render: r => rateText(r.engaged, r.sessions, 0) },
    { key: 'contact', label: 'Tapped contact', num: true, sort: r => ratio(r.contact, r.sessions) ?? -1, render: r => rateText(r.contact, r.sessions, 1) },
    { key: 'formStarted', label: 'Started form', num: true, sort: r => ratio(r.formStarted, r.sessions) ?? -1, render: r => rateText(r.formStarted, r.sessions, 1) },
    { key: 'formSubmitted', label: 'Sent form', num: true, sort: r => ratio(r.formSubmitted, r.sessions) ?? -1, render: r => rateText(r.formSubmitted, r.sessions, 1) },
    { key: 'lead', label: 'Enquired', num: true, sort: r => ratio(r.lead, r.sessions) ?? -1, render: r => rateText(r.lead, r.sessions, 1) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Visits" value={count(first.count)} delta={change(first.count, first.prevCount)} />
        <Kpi label="Sent an enquiry" value={pct(lead?.overallRate, 1)} sub={`${count(lead?.count)} visits`} highlight />
        <Kpi label="Tapped to contact" value={rateText(data.contact.sessions, first.count, 1)} sub={`${count(data.contact.sessions)} visits`} delta={change(data.contact.sessions, data.contact.prevSessions)} />
        <Kpi label="Started the form" value={pct(started?.overallRate, 1)} sub={`${count(started?.count)} visits`} />
        <Kpi label="Left the form" value={count(data.abandoned)} sub={started?.count ? `${rateText(data.abandoned, started.count, 0)} of those who started` : 'Started but did not send'} />
      </KpiGrid>

      <Section title="Contact form funnel">
        <div className="space-y-1">
          {data.steps.map((s, i) => (
            <div key={s.key}>
              {i > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 pl-5 text-xs">
                  {s.dropOff > 0 ? (
                    <span className="text-red-500 font-medium">
                      {count(s.dropOff)} dropped ({pct(s.stepRate == null ? null : 1 - s.stepRate, 0)})
                    </span>
                  ) : (
                    <span className="text-green-600 dark:text-green-400 font-medium">No drop</span>
                  )}
                  <span className="text-foreground-muted">
                    step {pct(s.stepRate, 1)} · before {pct(s.prevStepRate, 1)}
                  </span>
                  <PointChange cur={s.stepRate} prev={s.prevStepRate} />
                </div>
              )}
              <div className="rounded-lg border border-border-default overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface-secondary/50">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i] }} />
                  <span className="text-sm font-semibold text-foreground flex-1 min-w-[140px]">{s.label}</span>
                  <span className="text-sm text-foreground-secondary tabular-nums">{count(s.count)}</span>
                  <span className="text-xs text-foreground-muted tabular-nums">before {count(s.prevCount)}</span>
                  <span className="font-bold text-foreground w-16 text-right tabular-nums">{pct(s.overallRate, 1)}</span>
                </div>
                <div className="px-4 py-2">
                  <div className="h-2.5 bg-surface-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(s.overallRate ?? 0) * 100}%`, backgroundColor: COLORS[i] }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Note>
            A step counts visits that reached it or any later one. Sent the form means the visitor pressed send; enquiry
            received means it reached your inbox (a send can fail a check, such as a missing phone or email). &quot;Before&quot;
            is the previous period of the same length.
          </Note>
        </div>
      </Section>

      <Section title="Taps to contact you directly">
        <HBars
          empty="No one tapped to call, WhatsApp or email in this period"
          color="rgba(59,130,246,0.6)"
          rows={data.contact.byTarget.map(k => ({ key: k.target, label: targetLabel(k.target), value: k.sessions, right: `${count(k.sessions)} visits · ${count(k.clicks)} taps` }))}
        />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="By device">
          <Table rows={data.byDevice} cols={bdCols('Device')} rowKey={r => r.key} empty="No visits" />
        </Section>
        <Section title="By channel">
          <Table rows={data.byChannel} cols={bdCols('Channel')} rowKey={r => r.key} empty="No visits" />
        </Section>
      </div>
    </div>
  )
}
