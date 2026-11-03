'use client'

import { CopyValue, DataTable, StatusBadge, type DataCol, type StatusMap } from '@/components/admin/kit'
import type { TenantServer } from '@controller/lib/ecom/fleet'
import type { TenantWorkloadStatus } from '@/lib/k8s/tenant-compute'
import { dateTimeIN } from '../cells'

const SERVER_STATE: StatusMap = {
  running: { label: 'Running', tone: 'green' },
  pending: { label: 'Starting', tone: 'amber' },
  stopping: { label: 'Stopping', tone: 'amber' },
  stopped: { label: 'Stopped', tone: 'muted' },
  'shutting-down': { label: 'Shutting down', tone: 'red' },
  terminated: { label: 'Terminated', tone: 'muted' },
}

const Id = ({ id }: { id: string }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <span className="font-mono text-xs text-foreground break-all">{id}</span>
    <CopyValue value={id} />
  </span>
)

const SERVER_COLS: DataCol<TenantServer>[] = [
  { key: 'id', label: 'Instance', sort: s => s.id, render: s => <Id id={s.id} /> },
  { key: 'name', label: 'Name', hideBelow: 'xl', sort: s => s.name, render: s => <span className="text-foreground-muted">{s.name || '—'}</span> },
  { key: 'type', label: 'Type', sort: s => s.type, render: s => <span className="font-mono text-xs">{s.type}</span> },
  { key: 'state', label: 'State', sort: s => s.state, render: s => <StatusBadge status={s.state} map={SERVER_STATE} /> },
  { key: 'az', label: 'Zone', sort: s => s.az, render: s => s.az },
  { key: 'launched', label: 'Launched', sortType: 'date', sort: s => (s.launchedAt ? new Date(s.launchedAt).getTime() : 0), render: s => <span className="text-foreground-muted">{dateTimeIN(s.launchedAt)}</span> },
]

/** The store's own EC2 servers, from the live fleet. */
export function ServersTable({ servers }: { servers: TenantServer[] }) {
  return (
    <DataTable
      sortNs="srv"
      rows={servers}
      cols={SERVER_COLS}
      rowKey={s => s.id}
      noun="servers"
      empty="No servers of its own."
      bare
      mobileCard={s => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1.5 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <Id id={s.id} />
            <StatusBadge status={s.state} map={SERVER_STATE} />
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-foreground-muted">
            <span className="font-mono">{s.type}</span>
            <span>{s.az}</span>
            <span>Launched {dateTimeIN(s.launchedAt)}</span>
          </div>
        </div>
      )}
    />
  )
}

type Pod = TenantWorkloadStatus['pods'][number]

const PodState = ({ p }: { p: Pod }) => <span className={p.ready ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>{p.ready ? 'Ready' : p.phase}</span>

const POD_COLS: DataCol<Pod>[] = [
  { key: 'name', label: 'Pod', sort: p => p.name, render: p => <span className="font-mono text-xs break-all">{p.name}</span> },
  { key: 'status', label: 'Status', sort: p => (p.ready ? 'Ready' : p.phase), render: p => <PodState p={p} /> },
  { key: 'restarts', label: 'Restarts', num: true, sort: p => p.restarts, render: p => p.restarts },
  { key: 'node', label: 'Node', hideBelow: 'lg', sort: p => p.node ?? '', render: p => <span className="font-mono text-xs">{p.node ?? '—'}</span> },
  { key: 'started', label: 'Started', sortType: 'date', sort: p => (p.startedAt ? new Date(p.startedAt).getTime() : 0), render: p => <span className="text-foreground-muted">{dateTimeIN(p.startedAt)}</span> },
]

/** The store's pods, read live from the API server. */
export function PodsTable({ pods }: { pods: Pod[] }) {
  return (
    <DataTable
      sortNs="pod"
      rows={pods}
      cols={POD_COLS}
      rowKey={p => p.name}
      noun="pods"
      empty="No pods."
      bare
      mobileCard={p => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1 min-w-0">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <span className="min-w-0 font-mono text-xs text-foreground break-all">{p.name}</span>
            <span className="shrink-0 text-xs">
              <PodState p={p} />
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-foreground-muted">
            <span>{p.restarts} restart{p.restarts === 1 ? '' : 's'}</span>
            {p.node && <span className="font-mono break-all">{p.node}</span>}
            <span>{dateTimeIN(p.startedAt)}</span>
          </div>
        </div>
      )}
    />
  )
}
