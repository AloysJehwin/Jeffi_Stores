'use client'

import { useState } from 'react'

interface MailLog {
  id: string
  email: string
  from_email: string
  subject: string
  template_name: string | null
  kind: string
  status: 'sent' | 'failed'
  error: string | null
  message_id: string | null
  sent_at: string
}

interface Props {
  orderId: string
}

function StatusBadge({ status }: { status: 'sent' | 'failed' }) {
  return status === 'sent' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3" />
      </svg>
      Sent
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3" />
      </svg>
      Failed
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MailLogsPanel({ orderId }: Props) {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<MailLog[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bodyHtml, setBodyHtml] = useState<Record<string, string>>({})
  const [bodyLoading, setBodyLoading] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/mail-logs`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setLogs(data.logs)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleToggle() {
    const next = !open
    setOpen(next)
    if (next && logs === null) load()
  }

  async function toggleBody(logId: string) {
    if (expandedId === logId) {
      setExpandedId(null)
      return
    }
    setExpandedId(logId)
    if (bodyHtml[logId] !== undefined) return
    setBodyLoading(logId)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/mail-logs/${logId}/body`)
      const data = await res.json()
      setBodyHtml(prev => ({ ...prev, [logId]: data.html || '' }))
    } catch {
      setBodyHtml(prev => ({ ...prev, [logId]: '' }))
    } finally {
      setBodyLoading(null)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-6 py-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h2 className="text-lg font-semibold text-foreground">Mail Logs</h2>
          {logs !== null && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-secondary text-foreground-muted">
              {logs.length}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-border-default pt-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted py-4">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading…
            </div>
          )}

          {error && <p className="text-sm text-red-500 py-4">{error}</p>}

          {!loading && !error && logs !== null && logs.length === 0 && (
            <p className="text-sm text-foreground-muted py-4">No emails sent for this order yet.</p>
          )}

          {!loading && !error && logs !== null && logs.length > 0 && (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="border border-border-default rounded-lg overflow-hidden">
                  <div className="px-4 py-3 flex items-start gap-3 bg-surface">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={log.status} />
                        {log.template_name && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-surface-secondary text-foreground-muted font-mono">
                            {log.template_name}
                          </span>
                        )}
                        <span className="text-[11px] text-foreground-muted">{formatDate(log.sent_at)}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground mt-1 truncate">{log.subject}</p>
                      <p className="text-xs text-foreground-muted mt-0.5">To: {log.email}</p>
                      {log.status === 'failed' && log.error && (
                        <p className="text-xs text-red-500 mt-1 line-clamp-2">{log.error}</p>
                      )}
                    </div>
                    {log.kind !== 'otp' && (
                      <button
                        type="button"
                        onClick={() => toggleBody(log.id)}
                        className="shrink-0 text-xs text-accent-500 hover:text-accent-600 font-medium mt-0.5"
                      >
                        {expandedId === log.id ? 'Hide' : 'Preview'}
                      </button>
                    )}
                  </div>

                  {log.kind === 'otp'
                    ? null
                    : expandedId === log.id && (
                        <div className="border-t border-border-default bg-white dark:bg-gray-950">
                          {bodyLoading === log.id ? (
                            <div className="flex items-center gap-2 text-xs text-foreground-muted p-4">
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                              Loading preview…
                            </div>
                          ) : bodyHtml[log.id] ? (
                            <iframe
                              srcDoc={bodyHtml[log.id]}
                              className="w-full border-0"
                              style={{ height: 420 }}
                              sandbox="allow-same-origin"
                              title={`Email preview: ${log.subject}`}
                            />
                          ) : (
                            <p className="text-xs text-foreground-muted p-4">No HTML body recorded.</p>
                          )}
                        </div>
                      )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
