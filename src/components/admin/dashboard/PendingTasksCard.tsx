'use client'

import { useState } from 'react'
import Link from 'next/link'

const PAGE_SIZE = 5

interface Task {
  id: string
  title: string
  customer_name?: string | null
  due_date?: string | null
  overdue?: boolean
  priority?: string
}

export default function PendingTasksCard({ tasks, viewAllHref }: { tasks: Task[]; viewAllHref: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)

  const totalPages = Math.ceil(tasks.length / PAGE_SIZE)
  const paginated = tasks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const overdueCount = tasks.filter(t => t.overdue).length

  return (
    <div className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none overflow-hidden">
      {/* Header — always visible, click to collapse */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-secondary transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-foreground-muted font-medium">My Pending Tasks</p>
          {tasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="text-xs font-semibold bg-surface-secondary text-foreground-secondary px-1.5 py-0.5 rounded-full">
                {tasks.length}
              </span>
              {overdueCount > 0 && (
                <span className="text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                  {overdueCount} overdue
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={viewAllHref}
            onClick={e => e.stopPropagation()}
            className="text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors"
          >
            View all
          </Link>
          <svg
            className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Collapsed summary — shows when closed and has tasks */}
      {!open && tasks.length > 0 && (
        <div className="px-5 py-2 border-t border-border-default/50 flex items-center gap-3 text-xs text-foreground-muted">
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${overdueCount > 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
            {overdueCount > 0 ? `${overdueCount} overdue` : `${tasks.length} pending`}
          </span>
          {tasks[0] && (
            <span className="truncate text-foreground-secondary">{tasks[0].title}</span>
          )}
        </div>
      )}

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border-default/50">
          {tasks.length > 0 ? (
            <>
              <ul className="divide-y divide-border-default/70">
                {paginated.map(t => (
                  <li key={t.id}>
                    <Link href={viewAllHref} className="flex items-center gap-3 px-5 py-2.5 group hover:bg-surface-secondary transition-colors">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-amber-500' : 'bg-foreground-muted/50'}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-foreground group-hover:text-accent-600 transition-colors truncate">{t.title}</span>
                        {t.customer_name && <span className="block text-xs text-foreground-muted truncate">{t.customer_name}</span>}
                      </span>
                      {t.due_date && (
                        <span className={`text-xs font-medium shrink-0 ${t.overdue ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
                          {t.overdue ? 'Overdue' : new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-default/50">
                  <span className="text-[11px] text-foreground-muted">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, tasks.length)} of {tasks.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage(p => p - 1)} disabled={page === 0}
                      className="px-2 py-0.5 text-xs rounded border border-border-default disabled:opacity-30 hover:bg-surface-secondary transition-colors"
                    >‹</button>
                    <button
                      onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                      className="px-2 py-0.5 text-xs rounded border border-border-default disabled:opacity-30 hover:bg-surface-secondary transition-colors"
                    >›</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2.5 px-5 py-3 text-foreground-muted">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span className="text-sm">No pending tasks assigned to you.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
