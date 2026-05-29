'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  low:    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}

export default function AdminTasksClient() {
  const router = useRouter()
  const [scope, setScope] = useState<'mine' | 'all' | 'unassigned'>('mine')
  const [status, setStatus] = useState<'open' | 'overdue' | 'completed'>('open')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tasks?scope=${scope}&status=${status}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setTasks(data.tasks || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [scope, status])

  async function complete(t: TaskRow) {
    setBusy(true)
    try {
      await fetch(`/api/admin/customers/${t.user_id}/tasks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: t.status === 'completed' ? 'pending' : 'completed' }),
      })
      await load()
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

  function assigneeName(t: TaskRow) {
    if (!t.assigned_to) return 'Unassigned'
    return `${t.assigned_first_name || ''} ${t.assigned_last_name || ''}`.trim() || t.assigned_username || 'Admin'
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

  const buckets = ['Overdue', 'Today', 'This week', 'Later', 'No due date', 'Completed']
  const grouped = tasks.reduce<Record<string, TaskRow[]>>((acc, t) => {
    const b = bucket(t)
    if (!acc[b]) acc[b] = []
    acc[b].push(t)
    return acc
  }, {})

  const counts = {
    open: tasks.filter(t => ['pending', 'in_progress'].includes(t.status)).length,
    overdue: tasks.filter(t => ['pending', 'in_progress'].includes(t.status) && t.due_date && new Date(t.due_date) < new Date(new Date().setHours(0, 0, 0, 0))).length,
    completed: tasks.filter(t => t.status === 'completed').length,
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScope('mine')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
              scope === 'mine' ? 'bg-accent-500 text-white' : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            My Tasks
          </button>
          <button
            onClick={() => setScope('unassigned')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
              scope === 'unassigned' ? 'bg-accent-500 text-white' : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            Unassigned
          </button>
          <button
            onClick={() => setScope('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
              scope === 'all' ? 'bg-accent-500 text-white' : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            All
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatus('open')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              status === 'open' ? 'bg-secondary-500 text-white' : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setStatus('overdue')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              status === 'overdue' ? 'bg-red-500 text-white' : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            Overdue
          </button>
          <button
            onClick={() => setStatus('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              status === 'completed' ? 'bg-green-500 text-white' : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            Completed (30d)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center text-foreground-muted text-sm">
          Loading…
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-12 text-center">
          <p className="text-foreground-muted text-sm">
            {status === 'completed' ? 'No tasks completed in the last 30 days.' : 'No tasks here. Nice and clean.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {buckets.map(b => grouped[b] && grouped[b].length > 0 && (
            <div key={b} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
              <div className={`px-5 py-3 border-b border-border-default flex items-center justify-between ${
                b === 'Overdue' ? 'bg-red-50 dark:bg-red-900/20' :
                b === 'Today' ? 'bg-orange-50 dark:bg-orange-900/20' :
                ''
              }`}>
                <h2 className={`font-semibold text-sm ${
                  b === 'Overdue' ? 'text-red-700 dark:text-red-300' :
                  b === 'Today' ? 'text-orange-700 dark:text-orange-300' :
                  'text-foreground'
                }`}>
                  {b}
                </h2>
                <span className="text-xs text-foreground-muted">{grouped[b].length}</span>
              </div>
              <div className="divide-y divide-border-default">
                {grouped[b].map(t => {
                  const due = dueLabel(t.due_date)
                  const completed = t.status === 'completed'
                  return (
                    <div key={t.id} className="px-5 py-3 flex items-start gap-3 hover:bg-surface-secondary/50 transition-colors">
                      <button
                        type="button"
                        onClick={() => complete(t)}
                        disabled={busy}
                        className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                          completed ? 'bg-green-500 border-green-500' : 'border-border-secondary hover:border-accent-500'
                        }`}
                        aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
                      >
                        {completed && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className={`text-sm font-medium ${completed ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {t.auto_created && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"/></svg>
                                auto
                              </span>
                            )}
                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${PRIORITY_BADGE[t.priority]}`}>
                              {t.priority}
                            </span>
                            {due && !completed && (
                              <span className={`text-[10px] ${due.color}`}>{due.text}</span>
                            )}
                          </div>
                        </div>
                        {t.description && (
                          <p className="text-xs mt-1 text-foreground-secondary line-clamp-2">{t.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[10px] text-foreground-muted">
                          <Link href={`/admin/customers/${t.user_id}`} className="text-accent-500 hover:text-accent-600 font-medium">
                            {customerName(t)}
                          </Link>
                          <span>·</span>
                          <span>{assigneeName(t)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
