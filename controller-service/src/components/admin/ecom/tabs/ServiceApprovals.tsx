'use client'

import { useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { useRouter } from 'next/navigation'
import type { ServiceApproval } from '@/lib/tenant-registry'

const BADGE: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400',
}
const LABEL: Record<string, string> = { messaging: 'Messaging API', documents: 'Documents API' }

/** Per-service approval for Messaging / Documents (sign-up or a later request). */
export default function ServiceApprovals({ tenantId, services, approvals }: { tenantId: string; services: string[]; approvals: ServiceApproval[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const toast = useActionToast()
  const setErr = (t: string | null) => t && toast.error(t)
  const rows = services.filter(s => s === 'messaging' || s === 'documents').map(s => approvals.find(a => a.service === s) ?? { service: s, status: 'approved', requested_at: '', reviewed_at: null, note: 'Approved before reviews existed' })
  if (!rows.length) return null

  async function decide(service: string, decision: 'approved' | 'rejected') {
    setBusy(service); setErr(null)
    const r = await fetch(`/api/admin/ecom/customers/${tenantId}/services`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service, decision, note: decision === 'rejected' ? note : undefined }) })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return setErr(d.error || 'Failed')
    setRejecting(null); setNote(''); router.refresh()
  }

  return (
    <section className="rounded-xl border border-border-default p-5 bg-surface-elevated">
      <h2 className="font-semibold text-foreground mb-1">API services</h2>
      <p className="text-xs text-foreground-muted mb-4">Sending and rendering start only once a service is approved. The owner is emailed either way.</p>
      <div className="divide-y divide-border-default">
        {rows.map(a => (
          <div key={a.service} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">{LABEL[a.service]}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${BADGE[a.status]}`}>{a.status}</span>
              <span className="text-xs text-foreground-muted">
                {a.status === 'pending' && a.requested_at ? `Requested ${new Date(a.requested_at).toLocaleString('en-IN')}` : a.note}
              </span>
              {a.status === 'pending' && (
                <div className="ml-auto flex gap-2">
                  <button disabled={!!busy} onClick={() => decide(a.service, 'approved')} className="control-sm text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">{busy === a.service ? 'Saving…' : 'Approve'}</button>
                  <button disabled={!!busy} onClick={() => setRejecting(rejecting === a.service ? null : a.service)} className="control-sm text-xs font-semibold border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:opacity-50">Reject</button>
                </div>
              )}
            </div>
            {rejecting === a.service && (
              <div className="mt-3 flex gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (sent to the owner)" className="field-md flex-1 border border-border-default bg-surface text-foreground" />
                <button disabled={!note.trim() || !!busy} onClick={() => decide(a.service, 'rejected')} className="control-sm text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Send rejection</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
