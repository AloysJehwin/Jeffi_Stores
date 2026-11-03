import Link from 'next/link'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { Section } from '../EcomUI'
import { FLEET_UNKNOWN, PlacementCell, RunningCell, ServersCell } from '../cells'
import { detailHref } from './labels'

/** What the store runs right now: placement, servers, pods and each Deployment. */
export default function RunningNow({ d, link = true }: { d: TenantDetailData; link?: boolean }) {
  const { fleet, fleetKnown, serversRunning } = d
  return (
    <Section
      title="Running now"
      action={
        link ? (
          <Link href={detailHref(d.t.id, 'instance')} className="text-sm text-accent-600 hover:underline">
            Instance →
          </Link>
        ) : undefined
      }
    >
      {!fleetKnown ? (
        <p className="text-sm text-foreground-muted">{FLEET_UNKNOWN}</p>
      ) : (
        <div className="space-y-4 min-w-0">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Now</dt>
              <dd className="mt-0.5">
                <RunningCell fleet={fleet} known={fleetKnown} servers={serversRunning} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Placement</dt>
              <dd className="mt-0.5">
                <PlacementCell fleet={fleet} known={fleetKnown} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-foreground-muted">Servers</dt>
              <dd className="mt-0.5 break-words">
                <ServersCell fleet={fleet} known={fleetKnown} />
              </dd>
            </div>
          </dl>
          <Deployments d={d} />
        </div>
      )}
    </Section>
  )
}

/** Each Deployment's ready/desired replicas, plus the on-node Postgres. */
export function Deployments({ d }: { d: TenantDetailData }) {
  const deps = d.fleet?.deployments ?? []
  if (!deps.length) return <p className="text-sm text-foreground-muted">No workloads deployed.</p>
  return (
    <ul className="divide-y divide-border-default rounded-lg border border-border-default">
      {deps.map(x => {
        const ok = x.desired > 0 && x.ready >= x.desired
        return (
          <li key={x.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-w-0">
            <span className="font-mono text-xs text-foreground break-all min-w-0">{x.name}</span>
            <span className={`shrink-0 tabular-nums text-xs ${ok ? 'text-green-600 dark:text-green-400' : x.desired === 0 ? 'text-foreground-muted' : 'text-amber-600 dark:text-amber-400'}`}>
              {x.desired === 0 ? 'scaled to 0' : `${x.ready}/${x.desired} ready`}
            </span>
          </li>
        )
      })}
      {d.fleet?.postgresReady != null && (
        <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="text-xs text-foreground">Postgres (on the server)</span>
          <span className={`shrink-0 text-xs ${d.fleet.postgresReady ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{d.fleet.postgresReady ? 'ready' : 'not ready'}</span>
        </li>
      )}
    </ul>
  )
}
