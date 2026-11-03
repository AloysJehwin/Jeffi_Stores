'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send, X } from 'lucide-react'
import { ActionButton, StatusBadge, humanize, useActionToast } from '@/components/admin/kit'
import type { ServiceApproval } from '@/lib/tenant-registry'
import { KYC_STATUS } from '../cells'

const LABEL: Record<string, string> = { messaging: 'Messaging API', documents: 'Documents API' }

/** Per-service approval for Messaging / Documents (sign-up or a later request). */
export default function ServiceApprovals({ tenantId, services, approvals }: { tenantId: string; services: string[]; approvals: ServiceApproval[] }) {
  const router = useRouter()
  const toast = useActionToast()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const rows = services
    .filter(s => s === 'messaging' || s === 'documents')
    .map(s => approvals.find(a => a.service === s) ?? { service: s, status: 'approved', requested_at: '', reviewed_at: null, note: 'Approved before reviews existed' })
  if (!rows.length) return null

  async function decide(service: string, decision: 'approved' | 'rejected') {
    const r = await fetch(`/api/admin/ecom/customers/${tenantId}/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, decision, note: decision === 'rejected' ? note : undefined }),
    }).catch(() => null)
    const d = await r?.json().catch(() => ({}))
    if (!r?.ok) return toast.error(d?.error || 'Failed')
    setRejecting(null)
    setNote('')
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-border-default p-4 sm:p-5 bg-surface-elevated min-w-0">
      <h2 className="font-semibold text-foreground mb-1">API services</h2>
      <p className="text-xs text-foreground-muted mb-4">Sending and rendering start only once a service is approved. The owner is emailed either way.</p>
      <div className="divide-y divide-border-default">
        {rows.map(a => (
          <div key={a.service} className="py-3 first:pt-0 last:pb-0 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-medium text-foreground">{LABEL[a.service]}</span>
              <StatusBadge status={a.status} map={KYC_STATUS} label={humanize(a.status)} />
              <span className="text-xs text-foreground-muted min-w-0 break-words">
                {a.status === 'pending' && a.requested_at ? `Requested ${new Date(a.requested_at).toLocaleString('en-IN')}` : a.note}
              </span>
              {a.status === 'pending' && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <ActionButton variant="primary" action={{ label: 'Approve', icon: Check, onClick: () => decide(a.service, 'approved') }} />
                  <ActionButton action={{ label: 'Reject', icon: X, danger: true, onClick: () => setRejecting(rejecting === a.service ? null : a.service) }} />
                </div>
              )}
            </div>
            {rejecting === a.service && (
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (sent to the owner)" className="field-md min-w-0 flex-1 basis-56 border border-border-default bg-surface text-foreground" />
                <ActionButton action={{ label: 'Send rejection', icon: Send, danger: true, disabled: !note.trim(), onClick: () => decide(a.service, 'rejected') }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
