'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AdminSelect from '@/components/admin/AdminSelect'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'

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
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}

const SEGMENTS = [
  { key: 'all', label: 'All' },
  { key: 'orders', label: 'Orders' },
  { key: 'support', label: 'Support' },
  { key: 'customers', label: 'Customers' },
  { key: 'security', label: 'Security' },
  { key: 'manual', label: 'Manual' },
]

const SEGMENT_COLORS: Record<string, string> = {
  orders: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  support: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  customers: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  security: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  manual: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
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

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

function segmentOf(t: TaskRow): string {
  if (!t.auto_created || !t.source_kind) return 'manual'
  return KIND_SEGMENT[t.source_kind] || 'manual'
}

function adminLabel(a: AdminOption) {
  return `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username
}

interface Suggestion {
  type: 'task' | 'customer'
  label: string
  sub?: string
}

function buildSuggestions(query: string, tasks: TaskRow[]): Suggestion[] {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const t of tasks) {
    if (t.title.toLowerCase().includes(q) && !seen.has('t:' + t.title)) {
      seen.add('t:' + t.title)
      out.push({ type: 'task', label: t.title })
    }
    const cname = `${t.customer_first_name || ''} ${t.customer_last_name || ''}`.trim()
    if (cname && cname.toLowerCase().includes(q) && !seen.has('c:' + cname)) {
      seen.add('c:' + cname)
      out.push({ type: 'customer', label: cname, sub: t.customer_email || undefined })
    }
    if (t.customer_email?.toLowerCase().includes(q) && !seen.has('e:' + t.customer_email)) {
      seen.add('e:' + t.customer_email)
      out.push({ type: 'customer', label: t.customer_email, sub: cname || undefined })
    }
    if (out.length >= 6) break
  }
  return out
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

  const options = [{ value: '', label: 'Unassigned' }, ...admins.map(a => ({ value: a.id, label: adminLabel(a) }))]

  async function onChange(adminId: string) {
    setSaving(true)
    try {
      await fetch(`/api/admin/customers/${task.user_id}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assigned_to: adminId || null }),
      })
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
  const [scope, setScope] = useState<'mine' | 'all' | 'unassigned'>('mine')
  const [status, setStatus] = useState<'open' | 'overdue' | 'completed'>('open')
  const [priority, setPriority] = useState<string>('all')
  const [segment, setSegment] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [admins, setAdmins] = useState<AdminOption[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestStyle, setSuggestStyle] = useState<React.CSSProperties>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const suggestRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/admin/admins', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.admins) setAdmins(d.admins)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(
    async (pg = page) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          scope,
          status,
          priority,
          segment,
          page: String(pg),
          ...(search.trim() ? { search: search.trim() } : {}),
        })
        const res = await fetch(`/api/admin/tasks?${params}`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setTasks(data.tasks || [])
          setTotal(data.total || 0)
          setTotalPages(data.totalPages || 1)
        }
      } finally {
        setLoading(false)
      }
    },
    [scope, status, priority, segment, search, page]
  )

  useEffect(() => {
    setPage(1)
    load(1)
  }, [scope, status, priority, segment])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      load(1)
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  useEffect(() => {
    load(page)
  }, [page])

  useEffect(() => {
    setSuggestions(buildSuggestions(search, tasks))
  }, [search, tasks])

  useEffect(() => {
    if (!showSuggestions || !searchRef.current) return
    const r = searchRef.current.getBoundingClientRect()
    const panelW = 288
    const left = r.right - panelW < 8 ? Math.max(8, r.left) : r.right - panelW
    setSuggestStyle({ position: 'fixed', top: r.bottom + 4, left, width: panelW, zIndex: 9999 })
  }, [showSuggestions, suggestions])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        suggestRef.current &&
        !suggestRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      )
        setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function complete(t: TaskRow) {
    setBusy(true)
    try {
      await fetch(`/api/admin/customers/${t.user_id}/tasks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: t.status === 'completed' ? 'pending' : 'completed' }),
      })
      await load(page)
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
    if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: 'text-red-600 dark:text-red-400 font-semibold' }
    if (diff === 0) return { text: 'Due today', color: 'text-orange-600 dark:text-orange-400 font-semibold' }
    if (diff === 1) return { text: 'Due tomorrow', color: 'text-orange-500 dark:text-orange-400' }
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

  const start = (page - 1) * 25 + 1
  const end = Math.min(page * 25, total)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-1.5 bg-surface-elevated border border-border-default rounded-lg p-1">
          {(['mine', 'unassigned', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                scope === s
                  ? 'bg-accent-500 text-white shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground hover:bg-surface-secondary'
              }`}
            >
              {s === 'mine' ? 'My Tasks' : s === 'unassigned' ? 'Unassigned' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 bg-surface-elevated border border-border-default rounded-lg p-1">
          {[
            { key: 'open', label: 'Open', active: 'bg-secondary-500 text-white' },
            { key: 'overdue', label: 'Overdue', active: 'bg-red-500 text-white' },
            { key: 'completed', label: 'Completed (30d)', active: 'bg-green-600 text-white' },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key as any)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                status === s.key
                  ? s.active + ' shadow-sm'
                  : 'text-foreground-secondary hover:text-foreground hover:bg-surface-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SEGMENTS.map(seg => (
            <button
              key={seg.key}
              onClick={() => setSegment(seg.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border ${
                segment === seg.key
                  ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                  : 'border-border-default text-foreground-muted hover:text-foreground hover:border-border-secondary'
              }`}
            >
              {seg.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <AdminSelect
            value={priority}
            options={PRIORITY_OPTIONS}
            onChange={v => {
              setPriority(v)
              setPage(1)
            }}
            sm
          />

          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"
              />
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search tasks or customers…"
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setShowSuggestions(false)
                  setSearch('')
                }
              }}
              className="pl-7 pr-7 py-1.5 text-xs rounded-lg border border-border-default bg-surface-elevated text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40 w-56"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('')
                  setShowSuggestions(false)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestRef}
                style={suggestStyle}
                className="bg-surface-elevated border border-border-default rounded-xl shadow-xl overflow-hidden"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onMouseDown={e => {
                      e.preventDefault()
                      setSearch(s.label)
                      setShowSuggestions(false)
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-secondary transition-colors"
                  >
                    <span
                      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        s.type === 'task'
                          ? 'bg-accent-500/15 text-accent-600 dark:text-accent-400'
                          : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                      }`}
                    >
                      {s.type === 'task' ? 'T' : 'C'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{s.label}</p>
                      {s.sub && <p className="text-[10px] text-foreground-muted truncate">{s.sub}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {!loading && total > 0 && (
        <p className="text-xs text-foreground-muted">
          Showing {start}–{end} of {total.toLocaleString()} task{total !== 1 ? 's' : ''}
        </p>
      )}

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center text-foreground-muted text-sm animate-pulse">
          Loading…
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-12 text-center">
          <svg
            className="w-10 h-10 mx-auto mb-3 text-foreground-muted/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-foreground-muted text-sm">
            {search
              ? `No tasks matching "${search}"`
              : status === 'completed'
                ? 'No tasks completed in the last 30 days.'
                : 'No tasks here. Nice and clean.'}
          </p>
          {search && (
            <button onClick={() => setSearch('')} className="mt-2 text-xs text-accent-500 hover:text-accent-600">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {BUCKETS.map(
            b =>
              grouped[b] &&
              grouped[b].length > 0 && (
                <div key={b} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                  <div
                    className={`px-5 py-3 border-b border-border-default flex items-center justify-between ${
                      b === 'Overdue'
                        ? 'bg-red-50 dark:bg-red-900/20'
                        : b === 'Today'
                          ? 'bg-orange-50 dark:bg-orange-900/20'
                          : ''
                    }`}
                  >
                    <h2
                      className={`font-semibold text-sm ${
                        b === 'Overdue'
                          ? 'text-red-700 dark:text-red-300'
                          : b === 'Today'
                            ? 'text-orange-700 dark:text-orange-300'
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
                          className="px-5 py-3 flex items-start gap-3 hover:bg-surface-secondary/50 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => complete(t)}
                            disabled={busy || !canWrite}
                            className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                              completed
                                ? 'bg-green-500 border-green-500'
                                : 'border-border-secondary hover:border-accent-500'
                            } ${!canWrite ? 'cursor-default' : ''}`}
                            aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
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
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
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
                                href={ap(`/admin/customers/${t.user_id}`)}
                                className="text-[11px] text-accent-500 hover:text-accent-600 font-medium"
                              >
                                {customerName(t)}
                              </Link>
                              <span className="text-[10px] text-foreground-muted">·</span>
                              <AssignSelect task={t} admins={admins} onReassigned={() => load(page)} />
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-default bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | '…')[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs text-foreground-muted">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${
                      page === p
                        ? 'bg-accent-500 text-white shadow-sm'
                        : 'text-foreground-secondary hover:bg-surface-secondary'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-default bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
