'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Headset } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { ago } from '@/components/chat/format'
import type { SupportSession } from '@/lib/support/types'

/** Dashboard card: chats the assistant handed to a person that nobody has picked up yet. */
export default function SupportRequestsAlert() {
  const [sessions, setSessions] = useState<SupportSession[]>([])

  useEffect(() => {
    const load = () =>
      fetch('/api/admin/support/sessions?filter=needs_human&limit=8')
        .then(r => (r.ok ? r.json() : null))
        .then(d => d && setSessions(d.sessions ?? []))
        .catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  if (sessions.length === 0) return null

  return (
    <div className="bg-surface-elevated rounded-lg shadow border border-red-400/40 p-4 sm:p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
        <h2 className="text-lg font-bold text-foreground">
          Customers waiting for a person
          <span className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{sessions.length}</span>
        </h2>
        <a href={ap('/admin/support')} className="ml-auto text-xs font-medium text-primary-600 hover:underline">
          Open inbox
        </a>
      </div>
      <div className="space-y-2">
        {sessions.map(s => (
          <a
            key={s.id}
            href={ap(`/admin/support?s=${s.id}`)}
            className="flex items-center justify-between p-3 rounded-lg border border-border-default hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <Headset className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{s.customer.name}</p>
                <p className="text-xs text-foreground-muted truncate">{s.handoffReason || s.lastMessage?.text || s.customer.email || s.customer.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <span className="text-xs text-red-600 dark:text-red-400 font-semibold">Waiting {ago(s.handoffAt ?? s.createdAt)}</span>
              <ChevronRight className="w-4 h-4 text-foreground-muted group-hover:text-red-500 transition-colors" />
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
