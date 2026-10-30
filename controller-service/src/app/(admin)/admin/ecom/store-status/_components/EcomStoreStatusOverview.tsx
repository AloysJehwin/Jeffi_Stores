'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Activity } from 'lucide-react'
import { AttentionList } from '@/components/admin/overview/kit'
import {
  Kpi,
  KpiGrid,
  Section,
  Table,
  Badge,
  btnGhost,
  count,
  when,
  type Col,
  type Tone,
} from '@/components/admin/channels/ui'
import type { EcomStoreStatusOverview as Data } from '@controller/lib/overviews/ecom-store-status'
import { OverviewShell, Grid2, dateIn, label, useEcomOverview } from '../../_components/overview-shell'

const HEALTH_TONE: Record<string, Tone> = {
  up: 'green',
  degraded: 'amber',
  down: 'red',
  suspended: 'red',
  setting_up: 'blue',
}
const PROBE_TONE: Record<string, Tone> = { up: 'green', slow: 'amber', down: 'red' }
const KIND: Record<string, string> = {
  provisioning: 'Provisioning error',
  release: 'Schema release failed',
  suspended: 'Suspended',
}

type Incident = Data['incidents'][number]
const INCIDENT_COLS: Col<Incident>[] = [
  { key: 'at', label: 'When', render: r => when(r.at), sort: r => r.at },
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link
        href={`/admin/ecom/store-status/${r.id}/view`}
        className="font-medium text-foreground hover:text-accent-600"
      >
        {r.name}
      </Link>
    ),
  },
  {
    key: 'kind',
    label: 'What',
    render: r => <Badge tone={r.kind === 'suspended' ? 'red' : 'amber'}>{KIND[r.kind]}</Badge>,
  },
  {
    key: 'detail',
    label: 'Detail',
    render: r => (
      <span className="text-xs text-foreground-muted line-clamp-2">
        {[r.detail && label(r.detail), r.message].filter(Boolean).join(': ') || '-'}
      </span>
    ),
  },
]

type Store = Data['not_up'][number]
const STORE_COLS: Col<Store>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link
        href={`/admin/ecom/store-status/${r.id}/view`}
        className="font-medium text-foreground hover:text-accent-600"
      >
        {r.name}
      </Link>
    ),
  },
  { key: 'host', label: 'Host', render: r => <span className="text-xs text-foreground-muted">{r.slug}</span> },
  { key: 'plan', label: 'Plan', render: r => <span className="capitalize">{r.plan || '-'}</span> },
  { key: 'health', label: 'State', render: r => <Badge tone={HEALTH_TONE[r.health]}>{label(r.health)}</Badge> },
]

type Probe = NonNullable<Data['probe']>['results'][number]
const PROBE_COLS: Col<Probe>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link
        href={`/admin/ecom/store-status/${r.id}/view`}
        className="font-medium text-foreground hover:text-accent-600"
      >
        {r.name}
      </Link>
    ),
  },
  { key: 'state', label: 'State', render: r => <Badge tone={PROBE_TONE[r.state]}>{r.state}</Badge> },
  { key: 'status', label: 'HTTP', num: true, render: r => (r.status ? String(r.status) : 'no answer') },
  { key: 'ms', label: 'Time', num: true, render: r => `${count(r.ms)} ms`, sort: r => r.ms },
]

export default function EcomStoreStatusOverview() {
  const [probe, setProbe] = useState(false)
  const o = useEcomOverview<Data>('/api/admin/ecom/store-status/overview', probe ? '&probe=1' : '')
  return (
    <OverviewShell {...o}>
      {d => (
        <>
          <KpiGrid>
            <Kpi label="Up" value={count(d.health.up)} sub={`${count(d.live)} live stores`} highlight />
            <Kpi label="Degraded" value={count(d.health.degraded)} sub="failed release or domain" />
            <Kpi label="Down" value={count(d.health.down)} sub="instance stopped" />
            <Kpi label="Suspended" value={count(d.health.suspended)} />
            <Kpi label="Setting up" value={count(d.health.setting_up)} />
            <Kpi
              label="Incidents"
              value={count(d.current.incidents)}
              delta={d.deltas.incidents}
              invert
              sub={`${count(d.current.release_failures)} releases, ${count(d.current.provisioning_errors)} provisioning`}
            />
          </KpiGrid>

          <AttentionList items={d.attention} />

          <Section
            title="Live check"
            action={
              <button
                type="button"
                className={btnGhost}
                onClick={() => (probe ? o.reload() : setProbe(true))}
                disabled={o.loading}
              >
                <Activity className="w-4 h-4" />
                {d.probe ? 'Check again' : 'Check stores now'}
              </button>
            }
          >
            {d.probe ? (
              <>
                <p className="text-sm text-foreground-muted mb-3">
                  {count(d.probe.up)} up, {count(d.probe.slow)} slow (over 2 s), {count(d.probe.down)} down, checked{' '}
                  {when(d.probe.checked_at)}.
                </p>
                <Table rows={d.probe.results} cols={PROBE_COLS} rowKey={r => r.id} empty="No live stores to check" />
              </>
            ) : (
              <p className="text-sm text-foreground-muted">
                Uptime is not recorded. Run a check to call each live store&apos;s readiness endpoint.
              </p>
            )}
          </Section>

          <Grid2>
            <Section title="Stores not fully up">
              <Table rows={d.not_up} cols={STORE_COLS} rowKey={r => r.id} empty="Every store is up" />
            </Section>
            <Section title="Domains and certificates">
              <ul className="text-sm space-y-2">
                {(['verified', 'pending', 'verifying', 'failed'] as const).map(s => (
                  <li key={s} className="flex justify-between gap-3">
                    <span className="text-foreground-secondary">Custom domains {s}</span>
                    <span className="tabular-nums text-foreground">{count(d.domains[s] ?? 0)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border-default pt-2">
                  <span className="text-foreground-secondary">Admin certificates active</span>
                  <span className="tabular-nums text-foreground">{count(d.certs.admin_certs)}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-foreground-secondary">Admin certificates expiring in 30 days</span>
                  <span className="tabular-nums text-foreground">{count(d.certs.admin_certs_expiring_30d)}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-foreground-secondary">Store CAs expiring in 30 days</span>
                  <span className="tabular-nums text-foreground">{count(d.certs.ca_expiring_30d)}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-foreground-secondary">Next CA expiry</span>
                  <span className="tabular-nums text-foreground">{dateIn(d.certs.next_ca_expiry)}</span>
                </li>
              </ul>
            </Section>
          </Grid2>

          <Section title="Incidents in this period">
            <Table
              rows={d.incidents}
              cols={INCIDENT_COLS}
              rowKey={r => `${r.kind}-${r.id}-${r.at}`}
              empty="No incidents in this period"
            />
          </Section>
        </>
      )}
    </OverviewShell>
  )
}
