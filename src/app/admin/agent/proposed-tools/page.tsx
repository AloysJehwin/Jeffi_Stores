'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2, Code, Mail, Sparkles } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

interface ProposedTool {
  id: string
  name: string
  description: string
  kind: 'readonly_sql' | 'templated_email'
  args_schema: any
  sql_template: string | null
  email_template: { subject: string; body: string; recipientArg: string } | null
  status: 'proposed' | 'approved' | 'rejected' | 'retired'
  source_prompt: string
  created_at: string
  decided_at: string | null
  rejection_reason: string | null
  invocation_count: number
  last_invoked_at: string | null
}

export default function ProposedToolsPage() {
  const { showToast } = useToast()
  const [items, setItems] = useState<ProposedTool[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'proposed' | 'approved' | 'rejected' | 'all'>('proposed')
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/agent/proposed-tools?status=${statusFilter}&limit=100`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      setItems(data.items || [])
    } catch (err: any) {
      showToast(err?.message || 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function decide(id: string, decision: 'approve' | 'reject') {
    if (decision === 'reject') {
      setRejectingId(id)
      setRejectReason('')
      return
    }
    await submitDecision(id, 'approve', '')
  }

  async function submitDecision(id: string, decision: 'approve' | 'reject', reason: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/agent/proposed-tools/${id}/${decision}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'reject' ? { reason } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      showToast(decision === 'approve' ? 'Tool approved and now callable' : 'Rejected', 'success')
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err: any) {
      showToast(err?.message || 'Action failed', 'error')
    } finally {
      setBusyId(null)
      setRejectingId(null)
      setRejectReason('')
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent-500" />
          <h1 className="text-xl font-bold text-foreground">Proposed Tools</h1>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-3 py-1.5 text-sm bg-surface border border-border-default rounded-lg text-foreground"
        >
          <option value="proposed">Proposed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      <p className="text-xs text-foreground-muted mb-4">
        New admin-agent capabilities proposed by the LLM. <strong>Approving here makes them callable</strong> by the admin agent — every individual invocation will still go through the normal action approval queue.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-foreground-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-sm text-foreground-muted">
          Nothing in the {statusFilter} queue.
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {item.kind === 'readonly_sql' ? <Code className="w-4 h-4 text-blue-500" /> : <Mail className="w-4 h-4 text-amber-500" />}
                  <p className="text-sm font-mono font-semibold text-foreground">{item.name}</p>
                </div>
                <p className="text-sm text-foreground">{item.description}</p>
                <p className="text-[10px] text-foreground-muted mt-1">
                  {item.kind} · {new Date(item.created_at).toLocaleString()}
                  {item.status === 'approved' && ` · ${item.invocation_count} invocation${item.invocation_count === 1 ? '' : 's'}`}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                item.status === 'proposed' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' :
                item.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' :
                'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
              }`}>{item.status}</span>
            </div>

            <details className="mb-3">
              <summary className="text-[11px] text-foreground-muted cursor-pointer">Original request</summary>
              <p className="text-xs text-foreground-muted mt-1 p-2 bg-surface-secondary rounded">{item.source_prompt}</p>
            </details>

            <details className="mb-3">
              <summary className="text-[11px] text-foreground-muted cursor-pointer">Args schema</summary>
              <pre className="text-[11px] font-mono mt-1 p-2 bg-surface-secondary rounded overflow-x-auto">{JSON.stringify(item.args_schema, null, 2)}</pre>
            </details>

            {item.kind === 'readonly_sql' && item.sql_template && (
              <details className="mb-3" open>
                <summary className="text-[11px] text-foreground-muted cursor-pointer">SQL template</summary>
                <pre className="text-[11px] font-mono mt-1 p-2 bg-surface-secondary rounded overflow-x-auto whitespace-pre-wrap">{item.sql_template}</pre>
              </details>
            )}

            {item.kind === 'templated_email' && item.email_template && (
              <details className="mb-3" open>
                <summary className="text-[11px] text-foreground-muted cursor-pointer">Email template</summary>
                <div className="text-xs mt-1 p-2 bg-surface-secondary rounded space-y-1">
                  <p><strong>Subject:</strong> {item.email_template.subject}</p>
                  <p><strong>Recipient arg:</strong> <code className="font-mono">{item.email_template.recipientArg}</code></p>
                  <pre className="font-mono whitespace-pre-wrap text-[11px] mt-2">{item.email_template.body}</pre>
                </div>
              </details>
            )}

            {item.rejection_reason && (
              <p className="text-[11px] text-red-700 dark:text-red-300 mb-2">Rejection: {item.rejection_reason}</p>
            )}

            {item.status === 'proposed' && (
              <div className="flex flex-col gap-2">
                {rejectingId === item.id ? (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejecting (optional)"
                      className="w-full px-3 py-1.5 text-xs border border-border-default rounded bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitDecision(item.id, 'reject', rejectReason)
                        if (e.key === 'Escape') { setRejectingId(null); setRejectReason('') }
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === item.id}
                        onClick={() => submitDecision(item.id, 'reject', rejectReason)}
                        className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        Confirm reject
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectReason('') }}
                        className="px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold border border-border-default"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === item.id}
                      onClick={() => decide(item.id, 'approve')}
                      className="flex-1 px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      {busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      Approve and register
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => decide(item.id, 'reject')}
                      className="flex-1 px-3 py-1.5 bg-surface hover:bg-surface-secondary text-foreground rounded text-xs font-semibold flex items-center justify-center gap-1 border border-border-default disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
