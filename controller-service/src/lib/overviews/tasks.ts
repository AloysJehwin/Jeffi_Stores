import { queryMany, queryOne } from '@/lib/shared/db'
import type { Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { kpi, n, nn, periodSql, plural, snapshot, type OverviewKpi } from './ops-kpi'

// Tasks strip over customer_tasks (the only task table). Open is pending or in progress;
// overdue is open with a due date before today in IST, as the tasks list defines it.

const OPEN = `status IN ('pending', 'in_progress')`
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`

export interface TaskSnapshot {
  open: number
  overdue: number
  overdue_urgent: number
  due_today: number
  unassigned: number
}

export function taskAttention(s: TaskSnapshot): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.overdue)
    out.push({
      key: 'overdue',
      severity: s.overdue_urgent ? 'critical' : 'warning',
      title: `${plural(s.overdue, 'task')} overdue`,
      sub: s.overdue_urgent ? `${s.overdue_urgent} high or urgent` : undefined,
      href: '/admin/tasks?status=overdue&scope=all',
    })
  if (s.due_today)
    out.push({
      key: 'due_today',
      severity: 'info',
      title: `${plural(s.due_today, 'task')} due today`,
      href: '/admin/tasks?scope=all',
    })
  if (s.unassigned)
    out.push({
      key: 'unassigned',
      severity: 'info',
      title: `${plural(s.unassigned, 'open task')} with no assignee`,
      href: '/admin/tasks?scope=unassigned',
    })
  return out
}

export async function getTaskOverview(period: Period) {
  const ps = periodSql(period)
  const [flow, snap, byAssignee] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT p, SUM(created) AS created, SUM(completed) AS completed, AVG(hours) AS hours FROM (
         SELECT CASE WHEN ${ps.cur('created_at')} THEN 'cur' ELSE 'prev' END AS p, 1 AS created, 0 AS completed, NULL::float8 AS hours
         FROM customer_tasks WHERE ${ps.span('created_at')}
         UNION ALL
         SELECT CASE WHEN ${ps.cur('completed_at')} THEN 'cur' ELSE 'prev' END, 0, 1, EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600
         FROM customer_tasks WHERE status = 'completed' AND ${ps.span('completed_at')}
       ) x GROUP BY p`,
      ps.params
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${OPEN}) AS open,
              COUNT(*) FILTER (WHERE ${OPEN} AND due_date < ${TODAY}) AS overdue,
              COUNT(*) FILTER (WHERE ${OPEN} AND due_date < ${TODAY} AND priority IN ('high', 'urgent')) AS overdue_urgent,
              COUNT(*) FILTER (WHERE ${OPEN} AND due_date = ${TODAY}) AS due_today,
              COUNT(*) FILTER (WHERE ${OPEN} AND assigned_to IS NULL) AS unassigned
       FROM customer_tasks`
    ),
    queryMany<Record<string, unknown>>(
      `SELECT ct.assigned_to AS admin_id,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email, 'Unassigned') AS name,
              COUNT(*) FILTER (WHERE ct.${OPEN}) AS open,
              COUNT(*) FILTER (WHERE ct.${OPEN} AND ct.due_date < ${TODAY}) AS overdue,
              COUNT(*) FILTER (WHERE ct.status = 'completed' AND ${ps.cur('ct.completed_at')}) AS completed,
              AVG(EXTRACT(EPOCH FROM (ct.completed_at - ct.created_at)) / 3600)
                FILTER (WHERE ct.status = 'completed' AND ${ps.cur('ct.completed_at')}) AS hours
       FROM customer_tasks ct
       LEFT JOIN admins a ON a.id = ct.assigned_to
       LEFT JOIN users u ON u.id = a.user_id
       GROUP BY ct.assigned_to, u.first_name, u.last_name, u.email
       HAVING COUNT(*) FILTER (WHERE ct.${OPEN}) > 0 OR COUNT(*) FILTER (WHERE ct.status = 'completed' AND ${ps.cur('ct.completed_at')}) > 0
       ORDER BY open DESC, completed DESC LIMIT 8`,
      ps.params.slice(0, 2)
    ),
  ])

  const cur = flow.find(r => r.p === 'cur')
  const prev = flow.find(r => r.p === 'prev')
  const s: TaskSnapshot = {
    open: n(snap?.open),
    overdue: n(snap?.overdue),
    overdue_urgent: n(snap?.overdue_urgent),
    due_today: n(snap?.due_today),
    unassigned: n(snap?.unassigned),
  }
  const kpis: OverviewKpi[] = [
    snapshot('open', 'Open', s.open, 'count'),
    snapshot('overdue', 'Overdue', s.overdue, 'count', { invert: true }),
    kpi('created', 'Created', n(cur?.created), n(prev?.created), 'count'),
    kpi('completed', 'Completed', n(cur?.completed), n(prev?.completed), 'count'),
    kpi('time', 'Avg time to complete', nn(cur?.hours), nn(prev?.hours), 'hours', { invert: true }),
    snapshot('unassigned', 'Unassigned', s.unassigned, 'count', { invert: true }),
  ]
  return {
    range: period,
    previous_range: ps.previous,
    kpis,
    snapshot: s,
    by_assignee: byAssignee.map(r => ({
      admin_id: (r.admin_id as string | null) ?? null,
      name: String(r.name),
      open: n(r.open),
      overdue: n(r.overdue),
      completed: n(r.completed),
      hours: nn(r.hours),
    })),
    attention: taskAttention(s),
  }
}
