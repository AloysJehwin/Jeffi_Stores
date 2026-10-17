'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, Mail } from 'lucide-react'
import { Badge } from '@/components/admin/kit/core'

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
  return status === 'sent' ? <Badge tone="green">Sent</Badge> : <Badge tone="red">Failed</Badge>
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
    <section className="rounded-xl border border-border-default bg-surface-elevated">
      <button type="button" onClick={handleToggle} className="flex w-full items-center justify-between px-5 py-4 text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-accent-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Mail Logs</h2>
          {logs !== null && <Badge>{logs.length}</Badge>}
        </div>
        <ChevronDown className={`h-4 w-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border-default px-5 pb-5 pt-4">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-sm text-foreground-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
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
                        <div className="border-t border-border-default bg-surface">
                          {bodyLoading === log.id ? (
                            <div className="flex items-center gap-2 p-4 text-xs text-foreground-muted">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading preview...
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
    </section>
  )
}
