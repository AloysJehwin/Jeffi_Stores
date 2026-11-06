import type { ReactNode } from 'react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { TenantStatus, inr, inrHr } from '../cells'
import { apiServices, type DetailSection } from './labels'

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

/** The numbers that belong to this detail page only, two tiles a row on a phone. */
export default function KpiStrip({ d, section }: { d: TenantDetailData; section: DetailSection }) {
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
  const tiles: Record<DetailSection, ReactNode[]> = {
    store: [
      <Tile key="s" label="Status" value={status} sub={statusSub} />,
      <Tile key="p" label="Plan" value={cap(t.plan)} sub={`${cap(t.billing_interval)} · ${cap(t.subscription_status)}`} />,
      <Tile key="pr" label="Price / mo" value={price == null ? '—' : inr(price)} />,
      <Tile key="m" label="This month" value={cost.mtdEstimate == null ? '—' : inr(cost.mtdEstimate)} sub="Infra so far, estimate" />,
    ],
    instance: [
      <Tile key="sv" label="Servers" value={servers} sub={serversSub} />,
      <Tile key="pd" label="Pods" value={!fleetKnown ? '—' : fleet?.pods.total ? `${fleet.pods.ready}/${fleet.pods.total}` : 'None'} sub="Ready / total" />,
      <Tile key="aws" label="AWS / mo" value={inr(cost.awsMonth)} />,
      <Tile key="r" label="Infra rate" value={inrHr(cost.priceHour)} sub={cost.priceHour == null ? 'No compute applied' : undefined} />,
    ],
    status: [
      <Tile key="s" label="Status" value={status} sub={statusSub} />,
      <Tile key="sv" label="Serving" value={!fleetKnown ? '—' : fleet?.pods.total ? `${fleet.pods.ready}/${fleet.pods.total} pods` : 'No pods'} />,
      <Tile key="j" label="Provisioning" value={cap(job?.status)} sub={job?.step ? cap(job.step) : undefined} />,
      <Tile key="k" label="Review" value={d.kycPending ? 'Pending' : cap(d.kyc?.status)} />,
    ],
    billing: [
      <Tile key="pr" label="Price / mo" value={price == null ? '—' : inr(price)} />,
      <Tile key="aws" label="AWS / mo" value={inr(cost.awsMonth)} />,
      <Tile key="mg" label="Margin / mo" value={inr(cost.marginMonth)} />,
      <Tile key="w" label="Wallet" value={inr(row?.wallet_balance, 2)} />,
    ],
  }
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">{tiles[section]}</div>
}
