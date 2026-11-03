import type { ReactNode } from 'react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { TenantStatus, inr, inrHr } from '../cells'
import { apiServices } from './labels'

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium truncate">{label}</p>
      <div className="mt-1 text-base sm:text-lg font-bold text-foreground tabular-nums leading-tight break-words">{value}</div>
      {sub && <p className="text-[11px] text-foreground-muted mt-0.5 break-words">{sub}</p>}
    </div>
  )
}

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—')

/** Status, plan, what runs and what it costs, two tiles a row on a phone. */
export default function KpiStrip({ d }: { d: TenantDetailData }) {
  const { t, job, cost, row, fleet, fleetKnown, serversRunning } = d
  const status = <TenantStatus status={t.status} />
  const statusSub = job && (job.status === 'running' || job.status === 'pending') ? `Provisioning: ${job.step}` : job?.status === 'failed' ? `Failed at ${job.step}` : `Instance ${t.instance_state}`

  if (!d.isStore) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Tile label="Status" value={status} sub="API workspace" />
        <Tile label="Services" value={<span className="text-sm">{apiServices(t)}</span>} sub={d.kycPending ? 'Review pending' : undefined} />
        <Tile label="Wallet" value={inr(row?.wallet_balance, 2)} />
        <Tile label="Created" value={<span className="text-sm">{new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>} />
      </div>
    )
  }

  let servers: ReactNode = '—'
  let serversSub: ReactNode = 'Read from the cluster'
  if (fleetKnown) {
    const pods = fleet?.pods.total ? `${fleet.pods.ready}/${fleet.pods.total} pods ready` : 'No pods'
    if (fleet?.placement === 'pool') {
      servers = 'Shared pool'
      serversSub = pods
    } else {
      servers = `${serversRunning ?? 0} running`
      serversSub = fleet?.placement === 'dedicated' ? `Own server · ${pods}` : pods
    }
  }

  const price = row?.price_inr_month ?? cost.priceMonth
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
      <Tile label="Status" value={status} sub={statusSub} />
      <Tile label="Plan" value={cap(t.plan)} sub={`${cap(t.billing_interval)} · ${cap(t.subscription_status)}`} />
      <Tile label="Servers" value={servers} sub={serversSub} />
      <Tile label="Price / mo" value={price == null ? '—' : inr(price)} sub={cost.priceHour == null ? 'No compute applied' : `Infra ${inrHr(cost.priceHour)}`} />
      <Tile label="AWS / mo" value={inr(cost.awsMonth)} sub={cost.marginMonth == null ? undefined : `Margin ${inr(cost.marginMonth)}`} />
      <Tile label="This month" value={cost.mtdEstimate == null ? '—' : inr(cost.mtdEstimate)} sub="Infra so far, estimate" />
    </div>
  )
}
