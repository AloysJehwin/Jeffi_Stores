import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity, type Sql } from '@jeffi/list-filters'
import { TASK_FIELDS, TASK_KIND_SEGMENTS } from '../fields/tasks'
import { col, ist } from './shared'

type TaskKey = FieldKeys<typeof TASK_FIELDS>

const OPEN = "ct.status IN ('pending', 'in_progress')"
const ASSIGNEE = "COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email)"
const segment = (kinds: string[]): Sql => (_ctx, bind) => `ct.source_kind = ANY(${bind(kinds)}::text[])`

const SQL: Record<TaskKey, FieldSql> = {
  // "Mine" binds the signed-in admin (ctx.adminId); no admin matches nothing.
  scope: {
    kind: 'enum',
    virtual: {
      mine: (ctx, bind) => `ct.assigned_to = ${bind(ctx.adminId ?? null)}::uuid`,
      unassigned: 'ct.assigned_to IS NULL',
    },
  },
  status: {
    kind: 'enum',
    virtual: {
      open: OPEN,
      overdue: `${OPEN} AND ct.due_date < CURRENT_DATE`,
      completed: "ct.status = 'completed' AND ct.completed_at > NOW() - INTERVAL '30 days'",
    },
  },
  segment: {
    kind: 'enum',
    virtual: {
      ...Object.fromEntries(Object.entries(TASK_KIND_SEGMENTS).map(([k, kinds]) => [k, segment(kinds)])),
      manual: 'ct.auto_created = false',
    },
  },
  priority: { kind: 'enum', expr: 'ct.priority' },
  task_status: { kind: 'enum', expr: 'ct.status' },
  assigned: {
    kind: 'values',
    lateral: { from: 'admins a JOIN users u ON u.id = a.user_id', link: 'a.id = ct.assigned_to', expr: ASSIGNEE },
  },
  source: { kind: 'values', expr: 'ct.source_kind' },
  auto_created: { kind: 'bool', expr: 'ct.auto_created' },
  due: { kind: 'date', expr: 'ct.due_date', dateOnly: true },
  no_due: { kind: 'flag', expr: 'ct.due_date IS NULL' },
  created: { kind: 'date', expr: 'ct.created_at' },
}

export const TASKS_ENTITY: FilterEntity<TaskKey> = {
  key: 'tasks',
  scope: 'tasks:read',
  writeScope: 'tasks:write',
  // Rows carry customer names and emails, as the list does (customers:read).
  exportScope: 'customers:read',
  noun: 'Tasks',
  root: 'customer_tasks',
  alias: 'ct',
  fields: TASK_FIELDS,
  sql: SQL,
  period: 'created',
  search: {
    build: (q, idx) => {
      const p = `$${idx}`
      return {
        clause: `(ct.title ILIKE ${p} OR EXISTS (SELECT 1 FROM users cu WHERE cu.id = ct.user_id
          AND (cu.first_name ILIKE ${p} OR cu.last_name ILIKE ${p} OR cu.email ILIKE ${p})))`,
        params: [`%${escapeLike(q.trim())}%`],
        nextIdx: idx + 1,
      }
    },
  },
  facets: true,
  // Value help and export run outside the list route: "mine" needs the signed-in admin.
  context: async q => {
    if (!q.scope?.split('|').includes('mine')) return {}
    const { getAdminSession } = await import('@/lib/auth/admin-auth')
    return { adminId: (await getAdminSession())?.adminId ?? null }
  },
  export: {
    columns: [
      col('title', 'Task', 'ct.title'),
      col('status', 'Status', 'ct.status'),
      col('priority', 'Priority', 'ct.priority'),
      col('due', 'Due', "to_char(ct.due_date, 'YYYY-MM-DD')"),
      col(
        'customer',
        'Customer',
        "(SELECT COALESCE(NULLIF(TRIM(cu.first_name || ' ' || cu.last_name), ''), cu.email) FROM users cu WHERE cu.id = ct.user_id)"
      ),
      col('customer_email', 'Customer email', '(SELECT cu.email FROM users cu WHERE cu.id = ct.user_id)'),
      col('assigned', 'Assigned to', `(SELECT ${ASSIGNEE} FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = ct.assigned_to)`),
      col('source', 'Created by rule', 'ct.source_kind'),
      col('auto', 'Automatic', "CASE WHEN ct.auto_created THEN 'Yes' ELSE 'No' END"),
      col('created', 'Created', ist('ct.created_at')),
      col('completed', 'Completed', ist('ct.completed_at')),
      col('description', 'Description', 'ct.description'),
    ],
    keyset: ['ct.created_at', 'ct.id'],
  },
}
