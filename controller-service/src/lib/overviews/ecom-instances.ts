import type { Pool } from 'pg'
import { delta, previousPeriod, ratio, type Period } from '@/lib/overview/period'
import {
  NOT_PLATFORM,
  STORAGE_WARN,
  inIst,
  num,
  numOrNull,
  periodParams,
  platformAttention,
  round2,
  storageUse,
} from './ecom-platform'

// Platform overview of per-tenant infrastructure: provisioning jobs, instance state, schema
// release drift (tenant_migration_runs) and vault storage against the plan quota.

const STORE = `'store' = ANY(t.service_types) AND t.status NOT IN ('rejected', 'pending_approval', 'awaiting_payment')`

/** Most common value and how many items differ from it (schema release drift). */
export function driftFrom(values: (string | null)[]): { head: string | null; behind: number } {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  let head: string | null = null
  let best = 0
  for (const [v, n] of counts) if (n > best) [head, best] = [v, n]
  return { head, behind: values.filter(v => v && v !== head).length }
}

export async function getEcomInstancesOverview(pool: Pool, cur: Period) {
  const prev = previousPeriod(cur)
  const params = periodParams(cur, prev)

  const [fleet, regions, jobs, jobList, steps, migrations, storage, attention] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS stores,
              count(*) FILTER (WHERE i.rds_endpoint IS NOT NULL)::int AS provisioned,
              count(*) FILTER (WHERE t.status = 'active' AND i.rds_endpoint IS NULL)::int AS live_without_db,
              count(*) FILTER (WHERE t.status = 'active' AND t.instance_state = 'running')::int AS running,
              count(*) FILTER (WHERE t.instance_state <> 'running')::int AS stopped,
              count(*) FILTER (WHERE t.status = 'provisioning')::int AS provisioning,
              count(*) FILTER (WHERE t.status = 'suspended')::int AS suspended,
              count(*) FILTER (WHERE i.ec2_target IS NOT NULL AND i.ec2_target <> 'pool')::int AS dedicated,
              count(*) FILTER (WHERE i.id IS NOT NULL AND (i.ec2_target IS NULL OR i.ec2_target = 'pool'))::int AS pooled
       FROM tenants t LEFT JOIN tenant_infra i ON i.tenant_id = t.id
       WHERE ${NOT_PLATFORM} AND ${STORE} AND t.status <> 'terminated'`
    ),
    pool.query(
      `SELECT COALESCE(i.region, 'none') AS region, count(*)::int AS n
       FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id
       WHERE ${NOT_PLATFORM} AND t.status <> 'terminated' GROUP BY 1 ORDER BY 2 DESC`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE ${inIst('created_at', 1, 2)})::int AS started,
              count(*) FILTER (WHERE ${inIst('created_at', 3, 4)})::int AS started_prev,
              count(*) FILTER (WHERE status = 'done' AND ${inIst('updated_at', 1, 2)})::int AS done,
              count(*) FILTER (WHERE status = 'done' AND ${inIst('updated_at', 3, 4)})::int AS done_prev,
              count(*) FILTER (WHERE status = 'failed' AND ${inIst('updated_at', 1, 2)})::int AS failed,
              count(*) FILTER (WHERE status = 'failed' AND ${inIst('updated_at', 3, 4)})::int AS failed_prev,
              AVG(EXTRACT(EPOCH FROM updated_at - created_at) / 60) FILTER (WHERE status = 'done' AND ${inIst('updated_at', 1, 2)}) AS avg_minutes,
              AVG(EXTRACT(EPOCH FROM updated_at - created_at) / 60) FILTER (WHERE status = 'done' AND ${inIst('updated_at', 3, 4)}) AS avg_minutes_prev,
              count(*) FILTER (WHERE status IN ('pending', 'running'))::int AS open,
              count(*) FILTER (WHERE status IN ('pending', 'running') AND updated_at < now() - interval '30 minutes')::int AS stuck
       FROM provisioning_jobs`,
      params
    ),
    pool.query(
      `SELECT DISTINCT ON (j.tenant_id) j.tenant_id AS id, t.display_name AS name, t.status AS tenant_status,
              j.step, j.status, j.attempts, LEFT(j.last_error, 200) AS last_error, j.updated_at
       FROM provisioning_jobs j JOIN tenants t ON t.id = j.tenant_id
       WHERE j.status <> 'done' AND t.status <> 'terminated'
       ORDER BY j.tenant_id, j.created_at DESC`
    ),
    pool.query(
      `SELECT step, count(*)::int AS errors
       FROM provisioning_step_events WHERE status = 'error' AND ${inIst('created_at', 1, 2)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
      [cur.from, cur.to]
    ),
    pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (m.tenant_id) m.tenant_id, m.git_sha, m.status, m.ran_at
         FROM tenant_migration_runs m JOIN tenants t ON t.id = m.tenant_id
         WHERE t.status = 'active' ORDER BY m.tenant_id, m.ran_at DESC
       )
       SELECT (SELECT json_agg(json_build_object('sha', git_sha, 'status', status, 'ran_at', ran_at)) FROM latest) AS latest,
              (SELECT count(*) FROM tenant_migration_runs WHERE ${inIst('ran_at', 1, 2)})::int AS runs,
              (SELECT count(*) FROM tenant_migration_runs WHERE status = 'failed' AND ${inIst('ran_at', 1, 2)})::int AS failed,
              (SELECT count(*) FROM tenant_migration_runs WHERE status = 'failed' AND ${inIst('ran_at', 3, 4)})::int AS failed_prev`,
      params
    ),
    pool.query(
      `SELECT t.id, t.display_name AS name, p.slug AS plan, i.used_storage_bytes::bigint AS used, i.file_count,
              p.storage_quota_bytes::bigint AS quota
       FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id LEFT JOIN plans p ON p.id = t.plan_id
       WHERE ${NOT_PLATFORM} AND t.status = 'active'`
    ),
    platformAttention(pool, 'instances'),
  ])

  const f = fleet.rows[0]
  const j = jobs.rows[0]
  const mg = migrations.rows[0]
  const latest: { sha: string | null; status: string; ran_at: string }[] = mg.latest ?? []
  const drift = driftFrom(latest.map(x => x.sha))

  const usage = storage.rows.map(s => {
    const used = num(s.used)
    const quota = num(s.quota)
    return {
      id: s.id,
      name: s.name,
      plan: s.plan,
      used_bytes: used,
      quota_bytes: quota,
      files: num(s.file_count),
      share: storageUse(used, quota),
    }
  })
  const usedTotal = usage.reduce((a, x) => a + x.used_bytes, 0)
  const quotaTotal = usage.reduce((a, x) => a + x.quota_bytes, 0)

  const current = {
    started: num(j.started),
    done: num(j.done),
    failed: num(j.failed),
    success_rate: ratio(num(j.done), num(j.done) + num(j.failed)),
    avg_minutes: numOrNull(j.avg_minutes) == null ? null : round2(num(j.avg_minutes)),
    migration_failures: num(mg.failed),
  }
  const previous = {
    started: num(j.started_prev),
    done: num(j.done_prev),
    failed: num(j.failed_prev),
    success_rate: ratio(num(j.done_prev), num(j.done_prev) + num(j.failed_prev)),
    avg_minutes: numOrNull(j.avg_minutes_prev) == null ? null : round2(num(j.avg_minutes_prev)),
    migration_failures: num(mg.failed_prev),
  }

  return {
    range: cur,
    previous_range: prev,
    snapshot: {
      stores: num(f.stores),
      provisioned: num(f.provisioned),
      live_without_db: num(f.live_without_db),
      running: num(f.running),
      stopped: num(f.stopped),
      provisioning: num(f.provisioning),
      suspended: num(f.suspended),
      dedicated: num(f.dedicated),
      pooled: num(f.pooled),
      open_jobs: num(j.open),
      stuck_jobs: num(j.stuck),
    },
    current,
    previous,
    deltas: {
      started: delta(current.started, previous.started),
      failed: delta(current.failed, previous.failed),
      avg_minutes: delta(current.avg_minutes, previous.avg_minutes),
    },
    regions: regions.rows.map(r => ({ region: r.region, stores: num(r.n) })),
    open_jobs: jobList.rows.map(r => ({
      id: r.id,
      name: r.name,
      tenant_status: r.tenant_status,
      step: r.step,
      status: r.status,
      attempts: num(r.attempts),
      last_error: r.last_error,
      updated_at: r.updated_at,
    })),
    step_errors: steps.rows.map(s => ({ step: s.step, errors: num(s.errors) })),
    releases: {
      stores: latest.length,
      head: drift.head,
      behind: drift.behind,
      failed_latest: latest.filter(x => x.status === 'failed').length,
      runs: num(mg.runs),
    },
    storage: {
      used_bytes: usedTotal,
      quota_bytes: quotaTotal,
      share: storageUse(usedTotal, quotaTotal),
      near_quota: usage.filter(u => (u.share ?? 0) >= STORAGE_WARN).length,
      top: usage
        .filter(u => u.used_bytes > 0)
        .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || b.used_bytes - a.used_bytes)
        .slice(0, 10),
    },
    attention,
  }
}

export type EcomInstancesOverview = Awaited<ReturnType<typeof getEcomInstancesOverview>>
