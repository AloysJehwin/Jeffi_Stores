'use client'

import { useState, useEffect } from 'react'

interface SupportSession {
  id: string
  user_id: string
  customer_name: string
  customer_email: string
  created_at: string
  admin_name: string | null
}

export default function SupportRequestsAlert() {
  const [sessions, setSessions] = useState<SupportSession[]>([])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchSessions() {
    try {
      const res = await fetch('/api/admin/support/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch {}
  }

  if (sessions.length === 0) return null

  return (
    <div className="bg-surface-elevated rounded-lg shadow border border-red-400/40 p-4 sm:p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
        <h2 className="text-lg font-bold text-foreground">
          Support Requests
          <span className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{sessions.length}</span>
        </h2>
      </div>
      <div className="space-y-2">
        {sessions.map(s => (
          <a
            key={s.id}
            href={`/admin/customers/${s.user_id}?chat=true`}
            className="flex items-center justify-between p-3 rounded-lg border border-border-default hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.customer_name}</p>
                <p className="text-xs text-foreground-muted truncate">{s.customer_email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              {s.admin_name ? (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{s.admin_name}</span>
              ) : (
                <span className="text-xs text-red-600 dark:text-red-400 font-semibold">Waiting</span>
              )}
              <span className="text-xs text-foreground-muted">
                {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <svg className="w-4 h-4 text-foreground-muted group-hover:text-red-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
