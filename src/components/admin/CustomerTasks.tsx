'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminSelect from '@/components/admin/AdminSelect'
import { useConfirm } from '@/contexts/ConfirmContext'
import DatePicker from '@/components/ui/DatePicker'

interface Task {
  id: string
  title: string
  description: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  completed_at: string | null
  created_at: string
  auto_created: boolean
  source_kind: string | null
  source_ref_id: string | null
  created_by_first_name: string | null
  created_by_last_name: string | null
  created_by_username: string | null
  assigned_to: string | null
  assigned_to_first_name: string | null
  assigned_to_last_name: string | null
  assigned_to_username: string | null
}

interface AdminOption {
  id: string
  username: string
  first_name: string | null
  last_name: string | null
  role: string
}

interface CustomerTasksProps {
  customerId: string
  canWrite?: boolean
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  low:    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
}

export default function CustomerTasks({ customerId, canWrite = false }: CustomerTasksProps) {
  const router = useRouter()
  const confirm = useConfirm()
  const [tasks, setTasks] = useState<Task[]>([])
  const [admins, setAdmins] = useState<AdminOption[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [assignedTo, setAssignedTo] = useState<string>('')

  async function load() {
    const res = await fetch(
      `/api/admin/customers/${customerId}/tasks?status=${showCompleted ? 'completed' : 'open'}`,
      { credentials: 'include' }
    )
    if (res.ok) {
      const data = await res.json()
      setTasks(data.tasks || [])
    }
  }

  useEffect(() => {
    load()
    fetch('/api/admin/admins', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAdmins(d.admins || []))
      .catch(() => {})
  }, [showCompleted])

  async function add() {
    const t = title.trim()
    if (!t) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: t,
          description: description.trim() || null,
          due_date: dueDate || null,
          priority,
          assigned_to: assignedTo || null,
        }),
      })
      if (res.ok) {
        setTitle('')
        setDescription('')
        setDueDate('')
        setPriority('medium')
        setAssignedTo('')
        setAdding(false)
        await load()
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggle(task: Task) {
    setBusy(true)
    try {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed'
      await fetch(`/api/admin/customers/${customerId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      })
      await load()
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(taskId: string) {
    const ok = await confirm({ message: 'Delete this task?', variant: 'danger', confirmLabel: 'Delete' })
    if (!ok) return
    setBusy(true)
    try {
      await fetch(`/api/admin/customers/${customerId}/tasks/${taskId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      await load()
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function adminName(a: AdminOption | { first_name: string | null; last_name: string | null; username: string | null }) {
    const f = a.first_name || ''
    const l = a.last_name || ''
    return `${f} ${l}`.trim() || a.username || 'Admin'
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Tasks</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCompleted(s => !s)}
            className="text-[10px] uppercase tracking-wider text-foreground-muted hover:text-foreground transition-colors"
          >
            {showCompleted ? 'Show Open' : 'Show Completed'}
          </button>
          {!adding && canWrite && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="px-2.5 py-1 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95"
            >
              + Add
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="mb-3 p-3 bg-surface-secondary rounded-lg border border-border-default space-y-2">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task title (e.g. Call about return)"
            maxLength={255}
            className="w-full px-2.5 py-1.5 text-sm border border-border-secondary rounded bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            maxLength={2000}
            className="w-full px-2.5 py-1.5 text-sm border border-border-secondary rounded bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent-500 resize-none"
          />
          <div className="grid grid-cols-3 gap-2">
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="Due date"
              className="w-full"
            />
            <AdminSelect
              sm
              value={priority}
              onChange={v => setPriority(v as any)}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'urgent', label: 'Urgent' },
              ]}
            />
            <AdminSelect
              sm
              value={assignedTo}
              onChange={v => setAssignedTo(v)}
              placeholder="Assign to me"
              options={[
                { value: '', label: 'Assign to me' },
                ...admins.map(a => ({ value: a.id, label: adminName(a) })),
              ]}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setAdding(false); setTitle(''); setDescription(''); setDueDate('') }}
              className="px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={busy || !title.trim()}
              className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              Create Task
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="text-xs text-foreground-muted italic">{showCompleted ? 'No completed tasks' : 'No open tasks'}</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {tasks.map(t => {
            const due = dueLabel(t.due_date)
            const completed = t.status === 'completed'
            return (
              <div
                key={t.id}
                className={`border border-border-default rounded-lg p-2.5 group transition-colors ${completed ? 'bg-surface-secondary/40' : 'bg-surface'}`}
              >
                <div className="flex items-start gap-2">
                  {canWrite && (
                  <button
                    type="button"
                    onClick={() => toggle(t)}
                    disabled={busy}
                    className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                      completed
                        ? 'bg-green-500 border-green-500'
                        : 'border-border-secondary hover:border-accent-500'
                    }`}
                    aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {completed && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-medium ${completed ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
                        {t.title}
                      </p>
                      {canWrite && (
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground-muted hover:text-red-600 shrink-0"
                        aria-label="Delete task"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22" />
                        </svg>
                      </button>
                      )}
                    </div>
                    {t.description && (
                      <p className={`text-xs mt-1 whitespace-pre-wrap break-words ${completed ? 'text-foreground-muted' : 'text-foreground-secondary'}`}>
                        {t.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
                      {t.assigned_to && (
                        <span className="text-[10px] text-foreground-muted">
                          → {adminName({ first_name: t.assigned_to_first_name, last_name: t.assigned_to_last_name, username: t.assigned_to_username })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
