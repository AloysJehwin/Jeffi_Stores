'use client'

import Link from 'next/link'
import { AttentionList } from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, Badge, count, pct, when, type Col } from '@/components/admin/channels/ui'
import { RankedBars } from '@/components/admin/dashboard/Charts'
import type { EcomInstancesOverview as Data } from '@/lib/overviews/ecom-instances'
import { OverviewShell, Grid2, bytes, label, useEcomOverview } from '../../_components/overview-shell'

type Job = Data['open_jobs'][number]
const JOB_COLS: Col<Job>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link
        href={`/admin/ecom/customers/${r.id}/view?tab=provisioning`}
        className="font-medium text-foreground hover:text-accent-600"
      >
        {r.name}
      </Link>
    ),
  },
  { key: 'step', label: 'Step', render: r => label(r.step) },
  {
    key: 'status',
    label: 'Job',
    render: r => <Badge tone={r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge>,
  },
  { key: 'attempts', label: 'Attempts', num: true, render: r => count(r.attempts) },
  {
    key: 'error',
    label: 'Last error',
    render: r => <span className="text-xs text-foreground-muted line-clamp-2">{r.last_error || '-'}</span>,
  },
  { key: 'updated', label: 'Updated', render: r => when(r.updated_at), sort: r => r.updated_at },
]

type Use = Data['storage']['top'][number]
const STORAGE_COLS: Col<Use>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link href={`/admin/ecom/instances/${r.id}/view`} className="font-medium text-foreground hover:text-accent-600">
        {r.name}
      </Link>
    ),
  },
  { key: 'plan', label: 'Plan', render: r => <span className="capitalize">{r.plan || '-'}</span> },
  { key: 'files', label: 'Files', num: true, render: r => count(r.files) },
  { key: 'used', label: 'Used', num: true, render: r => bytes(r.used_bytes), sort: r => r.used_bytes },
  { key: 'quota', label: 'Quota', num: true, render: r => bytes(r.quota_bytes) },
  {
    key: 'share',
    label: 'Used %',
    num: true,
    render: r => <Badge tone={(r.share ?? 0) >= 0.8 ? 'red' : 'muted'}>{pct(r.share)}</Badge>,
    sort: r => r.share ?? 0,
  },
]

export default function EcomInstancesOverview() {
  const o = useEcomOverview<Data>('/api/admin/ecom/instances/overview')
  return (
    <OverviewShell {...o}>
      {d => (
        <>
          <KpiGrid>
            <Kpi
              label="Provisioned"
              value={`${count(d.snapshot.provisioned)} / ${count(d.snapshot.stores)}`}
              sub="stores with their own database"
              highlight
            />
            <Kpi label="Running" value={count(d.snapshot.running)} sub={`${count(d.snapshot.stopped)} stopped`} />
            <Kpi
              label="Pooled / dedicated"
              value={`${count(d.snapshot.pooled)} / ${count(d.snapshot.dedicated)}`}
              sub="compute"
            />
            <Kpi
              label="Provisioning runs"
              value={count(d.current.started)}
              delta={d.deltas.started}
              sub={`${count(d.current.done)} done`}
            />
            <Kpi
              label="Failed runs"
              value={count(d.current.failed)}
              delta={d.deltas.failed}
              invert
              sub={d.current.success_rate == null ? undefined : `${pct(d.current.success_rate)} success`}
            />
            <Kpi
              label="Time to provision"
              value={d.current.avg_minutes == null ? '-' : `${d.current.avg_minutes.toFixed(1)} min`}
              delta={d.deltas.avg_minutes}
              invert
            />
            <Kpi
              label="Open jobs"
              value={count(d.snapshot.open_jobs)}
              sub={`${count(d.snapshot.stuck_jobs)} stuck over 30 min`}
            />
            <Kpi
              label="Release drift"
              value={count(d.releases.behind)}
              sub={d.releases.head ? `behind ${d.releases.head.slice(0, 7)}` : 'no releases recorded'}
            />
            <Kpi
              label="Release failures"
              value={count(d.current.migration_failures)}
              invert
              sub={`${count(d.releases.runs)} runs in period`}
            />
            <Kpi
              label="Storage used"
              value={bytes(d.storage.used_bytes)}
              sub={`${pct(d.storage.share)} of ${bytes(d.storage.quota_bytes)}`}
            />
            <Kpi label="Near quota" value={count(d.storage.near_quota)} sub="at 80% or more" />
            <Kpi label="Live without DB" value={count(d.snapshot.live_without_db)} sub="active, no RDS endpoint" />
          </KpiGrid>

          <AttentionList items={d.attention} />

          <Section title="Unfinished provisioning jobs">
            <Table rows={d.open_jobs} cols={JOB_COLS} rowKey={r => r.id} empty="Every provisioning job has finished" />
          </Section>

          <Grid2>
            <Section title="Failing steps this period">
              <RankedBars
                items={d.step_errors.map(s => ({ name: label(s.step), value: s.errors }))}
                unit="errors"
                barClass="bg-red-500"
              />
            </Section>
            <Section title="Stores by region">
              <RankedBars items={d.regions.map(r => ({ name: r.region, value: r.stores }))} unit="stores" />
            </Section>
          </Grid2>

          <Section title="Storage against plan quota">
            <Table rows={d.storage.top} cols={STORAGE_COLS} rowKey={r => r.id} empty="No vault storage used yet" />
          </Section>
        </>
      )}
    </OverviewShell>
  )
}
