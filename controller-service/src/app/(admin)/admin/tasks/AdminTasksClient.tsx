'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { canonicalQuery } from '@jeffi/list-filters/client'
import AdminSelect from '@/components/admin/AdminSelect'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import { EmptyState, ListSkeleton } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
import { ListFilters } from '@/components/admin/kit/list-filters'
import { TASK_FIELDS, TASK_SEARCH } from '@/lib/filters/fields/tasks'

interface AdminOption {
  id: string
  username: string
  role: string
  first_name: string | null
  last_name: string | null
}

interface TaskRow {
  id: string
  title: string
  description: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  completed_at: string | null
  auto_created: boolean
  source_kind: string | null
  source_ref_id: string | null
  user_id: string
  customer_first_name: string | null
  customer_last_name: string | null
  customer_email: string | null
  assigned_to: string | null
  assigned_first_name: string | null
  assigned_last_name: string | null
  assigned_username: string | null
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400',
  high: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  medium: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  low: 'bg-surface-secondary text-foreground-muted',
}

const SEGMENT_COLORS: Record<string, string> = {
  orders: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  support: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  customers: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  security: 'bg-red-500/10 text-red-500',
  manual: 'bg-surface-secondary text-foreground-muted',
}

const KIND_SEGMENT: Record<string, string> = {
  process_confirmed: 'orders',
  stuck_processing: 'orders',
  stuck_shipment: 'orders',
  ndr_check: 'orders',
  address_rto: 'orders',
  chase_refund: 'orders',
  review_return: 'orders',
  schedule_pickup: 'orders',
  inspect_refund: 'orders',
  process_refund: 'orders',
  confirm_cod_payment: 'orders',
  review_high_value_order: 'orders',
  review_flagged: 'orders',
  contact_failed_payment: 'orders',
  retry_failed_refund: 'orders',
  abandoned_checkout: 'orders',
  support_pickup: 'support',
  support_urgent: 'support',
  b2b_welcome: 'customers',
  collect_gst: 'customers',
  vip_check_in: 'customers',
  winback: 'customers',
  lead_followup: 'customers',
  save_customer: 'customers',
  respond_review: 'customers',
  followup_quote: 'customers',
  chase_quote_payment: 'customers',
  login_anomaly: 'security',
}

function segmentOf(t: TaskRow): string {
  if (!t.auto_created || !t.source_kind) return 'manual'
  return KIND_SEGMENT[t.source_kind] || 'manual'
}

function adminLabel(a: AdminOption) {
  return `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username
}

function AssignSelect({
  task,
  admins,
  onReassigned,
}: {
  task: TaskRow
  admins: AdminOption[]
  onReassigned: () => void
}) {
  const [saving, setSaving] = useState(false)
  const canWrite = useCanWrite('tasks:write')
  const toast = useActionToast()

  const options = [{ value: '', label: 'Unassigned' }, ...admins.map(a => ({ value: a.id, label: adminLabel(a) }))]

  async function onChange(adminId: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/customers/${task.user_id}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assigned_to: adminId || null }),
      })
      toast.result({ ok: res.ok }, { success: 'Task reassigned', error: 'Could not reassign the task' })
      onReassigned()
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) {
    const label = options.find(o => o.value === (task.assigned_to || ''))?.label || 'Unassigned'
    return <span className="text-[11px] text-foreground-muted">{label}</span>
  }

  return (
    <div
      onClick={e => e.stopPropagation()}
      className={`transition-opacity ${saving ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <AdminSelect
        value={task.assigned_to || ''}
        options={options}
        onChange={onChange}
        placeholder="Unassigned"
        compact
      />
    </div>
  )
}

export default function AdminTasksClient() {
  const router = useRouter()
  const canWrite = useCanWrite('tasks:write')
  // The list's filters from the URL. No Tasks / Status choice means all of them (the API defaults
  // to my open tasks, so say "all" explicitly).
  const sp = useSearchParams()
  const query = canonicalQuery(sp, TASK_FIELDS, { search: TASK_SEARCH.param })
  const q = new URLSearchParams(query)
  const search = q.get('search') || ''
  const status = q.get('status') || ''
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()

  const [admins, setAdmins] = useState<AdminOption[]>([])

  useEffect(() => {
    fetch('/api/admin/admins', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.admins) setAdmins(d.admins)
      })
      .catch(() => {})
  }, [])

  // API pages at 25 (?page); next page appends on scroll, filters start over.
  const list = useInfiniteList<TaskRow>({
    key: query,
    pageSize: 25,
    getKey: t => t.id,
    fetchPage: async (pg, signal) => {
      const params = new URLSearchParams(query)
      if (!params.has('scope')) params.set('scope', 'all')
      if (!params.has('status')) params.set('status', 'all')
      params.set('page', String(pg))
      const data = await fetchJson(`/api/admin/tasks?${params}`, signal)
      return { rows: data.tasks || [], total: data.total || 0, hasMore: pg < (data.totalPages || 1) }
    },
  })
  const tasks = list.rows
  const loading = list.loading
  const total = list.total ?? 0

  async function complete(t: TaskRow) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/customers/${t.user_id}/tasks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: t.status === 'completed' ? 'pending' : 'completed' }),
      })
      if (res.ok) {
        toast.success(t.status === 'completed' ? 'Task reopened' : 'Task completed')
        // Toggling moves the task out of an Open / Overdue / Completed filter.
        const next: TaskRow['status'] = t.status === 'completed' ? 'pending' : 'completed'
        list.setRows(rows =>
          status ? rows.filter(r => r.id !== t.id) : rows.map(r => (r.id === t.id ? { ...r, status: next } : r))
        )
      } else toast.error('Could not update the task')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function bucket(t: TaskRow): string {
    if (t.status === 'completed') return 'Completed'
    if (!t.due_date) return 'No due date'
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(t.due_date)
    due.setHours(0, 0, 0, 0)
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
    if (diff < 0) return 'Overdue'
    if (diff === 0) return 'Today'
    if (diff <= 7) return 'This week'
    return 'Later'
  }

  function customerName(t: TaskRow) {
    return `${t.customer_first_name || ''} ${t.customer_last_name || ''}`.trim() || t.customer_email || 'Unknown'
  }

  function dueLabel(d: string | null) {
    if (!d) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(d)
    due.setHours(0, 0, 0, 0)
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
    if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: 'text-red-500 font-semibold' }
    if (diff === 0) return { text: 'Due today', color: 'text-amber-600 dark:text-amber-400 font-semibold' }
    if (diff === 1) return { text: 'Due tomorrow', color: 'text-amber-500 dark:text-amber-400' }
    if (diff <= 7) return { text: `Due in ${diff}d`, color: 'text-foreground-secondary' }
    return { text: due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), color: 'text-foreground-muted' }
  }

  const BUCKETS = ['Overdue', 'Today', 'This week', 'Later', 'No due date', 'Completed']
  const grouped = tasks.reduce<Record<string, TaskRow[]>>((acc, t) => {
    const b = bucket(t)
    if (!acc[b]) acc[b] = []
    acc[b].push(t)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <ListFilters entity="tasks" fields={TASK_FIELDS} search={TASK_SEARCH} noun="Tasks" tab="list" exportable />

      {!loading && total > 0 && (
        <p className="text-xs text-foreground-muted">
          {total.toLocaleString()} task{total !== 1 ? 's' : ''}
        </p>
      )}

      {loading ? (
        <ListSkeleton header={false} kpis={0} rows={6} cols={3} />
      ) : tasks.length === 0 ? (
        <EmptyState
          title={
            search
              ? `No tasks matching "${search}"`
              : status === 'completed'
                ? 'No tasks completed in the last 30 days.'
                : 'No tasks here. Nice and clean.'
          }
          actionNode={
            search ? (
              <button
                onClick={() => {
                  const p = new URLSearchParams(sp.toString())
                  p.delete('search')
                  router.replace(`${window.location.pathname}?${p}`, { scroll: false })
                }}
                className="text-xs text-accent-500 hover:text-accent-600"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {BUCKETS.map(
            b =>
              grouped[b] &&
              grouped[b].length > 0 && (
                <div key={b} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                  <div
                    className={`px-4 sm:px-5 py-3 border-b border-border-default flex items-center justify-between ${
                      b === 'Overdue'
                        ? 'bg-red-500/5'
                        : b === 'Today'
                          ? 'bg-amber-500/5 '
                          : ''
                    }`}
                  >
                    <h2
                      className={`font-semibold text-sm ${
                        b === 'Overdue'
                          ? 'text-red-600 dark:text-red-400'
                          : b === 'Today'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-foreground'
                      }`}
                    >
                      {b}
                    </h2>
                    <span className="text-xs text-foreground-muted">{grouped[b].length}</span>
                  </div>
                  <div className="divide-y divide-border-default">
                    {grouped[b].map(t => {
                      const due = dueLabel(t.due_date)
                      const completed = t.status === 'completed'
                      const seg = segmentOf(t)
                      return (
                        <div
                          key={t.id}
                          className="px-4 sm:px-5 py-3 flex items-start gap-2 sm:gap-3 hover:bg-surface-secondary/50 transition-colors"
                        >
                          {/* 32px tap area around the 16px box so it is easy to hit on a phone. */}
                          <button
                            type="button"
                            onClick={() => complete(t)}
                            disabled={busy || !canWrite}
                            className={`group -m-2 p-2 shrink-0 ${!canWrite ? 'cursor-default' : ''}`}
                            aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
                          >
                            <span
                              className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                                completed ? 'bg-green-500 border-green-500' : 'border-border-secondary group-hover:border-accent-500'
                              }`}
                            >
                            {completed && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            </span>
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <p
                                className={`text-sm font-medium ${completed ? 'line-through text-foreground-muted' : 'text-foreground'}`}
                              >
                                {t.title}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                {seg !== 'manual' && (
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${SEGMENT_COLORS[seg] || ''}`}
                                  >
                                    {seg}
                                  </span>
                                )}
                                {t.auto_created && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-500/10 text-violet-700 dark:text-violet-400">
                                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                      <path
                                        fillRule="evenodd"
                                        d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    auto
                                  </span>
                                )}
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${PRIORITY_BADGE[t.priority]}`}
                                >
                                  {t.priority}
                                </span>
                                {due && !completed && <span className={`text-[10px] ${due.color}`}>{due.text}</span>}
                              </div>
                            </div>

                            {t.description && (
                              <p className="text-xs mt-1 text-foreground-secondary line-clamp-2">{t.description}</p>
                            )}

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Link
                                href={ap(`/admin/customers/${t.user_id}/view`)}
                                className="text-[11px] text-accent-500 hover:text-accent-600 font-medium"
                              >
                                {customerName(t)}
                              </Link>
                              <span className="text-[10px] text-foreground-muted">·</span>
                              <AssignSelect task={t} admins={admins} onReassigned={list.reload} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
          )}
        </div>
      )}

      {!loading && <InfiniteFooter shown={tasks.length} control={list} noun="tasks" />}
    </div>
  )
}
