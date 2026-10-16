import type { Pool } from 'pg'
import { delta, previousPeriod, type Period } from '@/lib/overview/period'
import { NOT_PLATFORM, inIst, num, periodParams, platformAttention } from './ecom-platform'

// Platform overview of store health. Nothing records uptime, so "up/down" is the control-plane
// state (status + instance_state + last schema release); an optional live probe hits each live
// store's /api/ready on demand. Incidents are failed provisioning steps, failed schema releases
// and suspensions.

export type Health = 'up' | 'degraded' | 'down' | 'suspended' | 'setting_up'

/** Control-plane health of one store. */
export function healthOf(s: {
  status: string
  instance_state: string
  last_release: string | null
  domain_failed?: boolean
}): Health {
  if (s.status === 'suspended') return 'suspended'
  if (s.status !== 'active') return 'setting_up'
  if (s.instance_state !== 'running') return 'down'
  if (s.last_release === 'failed' || s.domain_failed) return 'degraded'
  return 'up'
}

export const SLOW_MS = 2000
const PROBE_TIMEOUT_MS = 5000
const PROBE_MAX = 50

export type ProbeResult = {
  id: string
  name: string
  url: string
  state: 'up' | 'slow' | 'down'
  status: number
  ms: number
}

/** Classify a probe: no answer or 5xx is down, over SLOW_MS is slow. */
export function probeState(status: number, ms: number): ProbeResult['state'] {
  if (!status || status >= 500) return 'down'
  return ms > SLOW_MS ? 'slow' : 'up'
}

async function probeOne(url: string): Promise<{ status: number; ms: number }> {
  const start = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const r = await fetch(url, { redirect: 'manual', signal: ctrl.signal, cache: 'no-store' })
    return { status: r.status, ms: Date.now() - start }
  } catch {
    return { status: 0, ms: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeStores(
  stores: { id: string; name: string; slug: string }[],
  rootDomain: string
): Promise<ProbeResult[]> {
  return Promise.all(
    stores.slice(0, PROBE_MAX).map(async s => {
      const url = `https://${s.slug}.${rootDomain}/api/ready`
      const { status, ms } = await probeOne(url)
      return { id: s.id, name: s.name, url, state: probeState(status, ms), status, ms }
    })
  )
}

export async function getEcomStoreStatusOverview(
  pool: Pool,
  cur: Period,
  opts: { probe?: boolean; rootDomain?: string } = {}
) {
  const prev = previousPeriod(cur)
  const params = periodParams(cur, prev)

  const [stores, incidents, incidentCounts, domains, certs, attention] = await Promise.all([
    pool.query(
      `SELECT t.id, t.display_name AS name, t.slug, t.status, t.instance_state, p.slug AS plan,
              (SELECT m.status FROM tenant_migration_runs m WHERE m.tenant_id = t.id ORDER BY m.ran_at DESC LIMIT 1) AS last_release,
              EXISTS (SELECT 1 FROM tenant_custom_domains d WHERE d.tenant_id = t.id AND d.status = 'failed') AS domain_failed
       FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND 'store' = ANY(t.service_types) AND t.status IN ('active', 'suspended', 'provisioning')
       ORDER BY t.display_name`
    ),
    pool.query(
      `SELECT * FROM (
         SELECT e.created_at AS at, t.id, t.display_name AS name, 'provisioning' AS kind, e.step AS detail, LEFT(e.message, 200) AS message
         FROM provisioning_step_events e JOIN tenants t ON t.id = e.tenant_id
         WHERE e.status = 'error' AND ${inIst('e.created_at', 1, 2)}
         UNION ALL
         SELECT m.ran_at, t.id, t.display_name, 'release', m.git_sha, LEFT(m.error, 200)
         FROM tenant_migration_runs m JOIN tenants t ON t.id = m.tenant_id
         WHERE m.status = 'failed' AND ${inIst('m.ran_at', 1, 2)}
         UNION ALL
         SELECT t.updated_at, t.id, t.display_name, 'suspended', t.subscription_status, NULL
         FROM tenants t WHERE ${NOT_PLATFORM} AND t.status = 'suspended' AND ${inIst('t.updated_at', 1, 2)}
       ) x ORDER BY at DESC LIMIT 20`,
      [cur.from, cur.to]
    ),
    pool.query(
      `SELECT
         (SELECT count(*) FROM provisioning_step_events e WHERE e.status = 'error' AND ${inIst('e.created_at', 1, 2)})::int AS provisioning,
         (SELECT count(*) FROM provisioning_step_events e WHERE e.status = 'error' AND ${inIst('e.created_at', 3, 4)})::int AS provisioning_prev,
         (SELECT count(*) FROM tenant_migration_runs m WHERE m.status = 'failed' AND ${inIst('m.ran_at', 1, 2)})::int AS release,
         (SELECT count(*) FROM tenant_migration_runs m WHERE m.status = 'failed' AND ${inIst('m.ran_at', 3, 4)})::int AS release_prev,
         (SELECT count(*) FROM tenants t WHERE ${NOT_PLATFORM} AND t.status = 'suspended' AND ${inIst('t.updated_at', 1, 2)})::int AS suspended,
         (SELECT count(*) FROM tenants t WHERE ${NOT_PLATFORM} AND t.status = 'suspended' AND ${inIst('t.updated_at', 3, 4)})::int AS suspended_prev`,
      params
    ),
    pool.query(
      `SELECT d.status, count(*)::int AS n FROM tenant_custom_domains d JOIN tenants t ON t.id = d.tenant_id WHERE t.status = 'active' GROUP BY 1`
    ),
    pool.query(
      `SELECT
         (SELECT min(ca.expires_at) FROM tenant_ca ca JOIN tenants t ON t.id = ca.tenant_id WHERE t.status = 'active') AS next_ca_expiry,
         (SELECT count(*) FROM tenant_ca ca JOIN tenants t ON t.id = ca.tenant_id WHERE t.status = 'active' AND ca.expires_at < now() + interval '30 days')::int AS ca_expiring_30d,
         (SELECT count(*) FROM tenant_admin_certs c JOIN tenants t ON t.id = c.tenant_id
            WHERE t.status = 'active' AND c.revoked_at IS NULL AND c.expires_at > now())::int AS admin_certs,
         (SELECT count(*) FROM tenant_admin_certs c JOIN tenants t ON t.id = c.tenant_id
            WHERE t.status = 'active' AND c.revoked_at IS NULL AND c.expires_at > now() AND c.expires_at < now() + interval '30 days')::int AS admin_certs_expiring_30d`
    ),
    platformAttention(pool, 'store-status'),
  ])

  const list = stores.rows.map(s => ({
    id: s.id as string,
    name: s.name as string,
    slug: s.slug as string,
    plan: s.plan as string | null,
    health: healthOf(s),
  }))
  const health: Record<Health, number> = { up: 0, degraded: 0, down: 0, suspended: 0, setting_up: 0 }
  for (const s of list) health[s.health]++

  const ic = incidentCounts.rows[0]
  const current = {
    incidents: num(ic.provisioning) + num(ic.release) + num(ic.suspended),
    provisioning_errors: num(ic.provisioning),
    release_failures: num(ic.release),
    suspensions: num(ic.suspended),
  }
  const previous = {
    incidents: num(ic.provisioning_prev) + num(ic.release_prev) + num(ic.suspended_prev),
    provisioning_errors: num(ic.provisioning_prev),
    release_failures: num(ic.release_prev),
    suspensions: num(ic.suspended_prev),
  }

  const live = list.filter(s => s.health === 'up' || s.health === 'degraded')
  const probe = opts.probe && opts.rootDomain ? await probeStores(live, opts.rootDomain) : null

  const c = certs.rows[0]
  return {
    range: cur,
    previous_range: prev,
    health,
    live: live.length,
    current,
    previous,
    deltas: { incidents: delta(current.incidents, previous.incidents) },
    incidents: incidents.rows.map(r => ({
      at: r.at,
      id: r.id,
      name: r.name,
      kind: r.kind as 'provisioning' | 'release' | 'suspended',
      detail: r.detail,
      message: r.message,
    })),
    not_up: list.filter(s => s.health !== 'up'),
    domains: Object.fromEntries(domains.rows.map(d => [d.status, num(d.n)])) as Record<string, number>,
    certs: {
      next_ca_expiry: c.next_ca_expiry,
      ca_expiring_30d: num(c.ca_expiring_30d),
      admin_certs: num(c.admin_certs),
      admin_certs_expiring_30d: num(c.admin_certs_expiring_30d),
    },
    probe: probe && {
      checked_at: new Date().toISOString(),
      up: probe.filter(p => p.state === 'up').length,
      slow: probe.filter(p => p.state === 'slow').length,
      down: probe.filter(p => p.state === 'down').length,
      results: probe.sort((a, b) => b.ms - a.ms),
    },
    attention,
  }
}

export type EcomStoreStatusOverview = Awaited<ReturnType<typeof getEcomStoreStatusOverview>>
