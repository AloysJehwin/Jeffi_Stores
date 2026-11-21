'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send, X } from 'lucide-react'
import { ActionButton, StatusBadge, humanize, useActionToast } from '@/components/admin/kit'
import type { ServiceApproval } from '@/lib/tenant-registry'
import { KYC_STATUS } from '../cells'
import { KybBadge, KybBlocked, kybBlock, type KybBlock, type KybReadiness } from './KybGate'

const LABEL: Record<string, string> = { messaging: 'Messaging API', documents: 'Documents API' }

/** Per-service approval for Messaging / Documents (sign-up or a later request), with each service's KYB. */
export default function ServiceApprovals({
  tenantId,
  services,
  approvals,
  readiness = {},
}: {
  tenantId: string
  services: string[]
  approvals: ServiceApproval[]
  readiness?: Partial<Record<string, KybReadiness>>
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [blocked, setBlocked] = useState<{ service: string; block: KybBlock } | null>(null)
  const rows = services
    .filter(s => s === 'messaging' || s === 'documents')
    .map(s => approvals.find(a => a.service === s) ?? { service: s, status: 'approved', requested_at: '', reviewed_at: null, note: 'Approved before reviews existed' })
  if (!rows.length) return null

  // `force` approves a service whose KYB isn't complete (the route answers 409 with what's missing otherwise).
  async function decide(service: string, decision: 'approved' | 'rejected', force = false) {
    const r = await fetch(`/api/admin/ecom/customers/${tenantId}/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, decision, note: decision === 'rejected' ? note : undefined, force: force || undefined }),
    }).catch(() => null)
    const d = await r?.json().catch(() => ({}))
    const block = kybBlock(r?.status, d)
    if (block) {
      setRejecting(null)
      return setBlocked({ service, block })
    }
    if (!r?.ok) return toast.error(d?.error || 'Failed')
    toast.success(`${LABEL[service] ?? service} ${decision}.`)
    setBlocked(null)
    setRejecting(null)
    setNote('')
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-border-default p-4 sm:p-5 bg-surface-elevated min-w-0">
      <h2 className="font-semibold text-foreground mb-1">API services</h2>
      <p className="text-xs text-foreground-muted mb-4">
        Sending and rendering start only once a service is approved, and approving needs its KYB complete. The owner is emailed either way.
      </p>
      <div className="divide-y divide-border-default">
        {rows.map(a => (
          <div key={a.service} className="py-3 first:pt-0 last:pb-0 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-medium text-foreground">{LABEL[a.service]}</span>
              <StatusBadge status={a.status} map={KYC_STATUS} label={humanize(a.status)} />
              <KybBadge readiness={readiness[a.service]} />
              <span className="text-xs text-foreground-muted min-w-0 break-words">
                {a.status === 'pending' && a.requested_at ? `Requested ${new Date(a.requested_at).toLocaleString('en-IN')}` : a.note}
              </span>
              {a.status === 'pending' && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <ActionButton variant="primary" action={{ label: 'Approve', icon: Check, onClick: () => decide(a.service, 'approved') }} />
                  <ActionButton
                    action={{
                      label: 'Reject',
                      icon: X,
                      danger: true,
                      onClick: () => {
                        setBlocked(null)
                        setRejecting(rejecting === a.service ? null : a.service)
                      },
                    }}
                  />
                </div>
              )}
            </div>
            {blocked?.service === a.service && (
              <div className="mt-3">
                <KybBlocked block={blocked.block} onForce={() => decide(a.service, 'approved', true)} onCancel={() => setBlocked(null)} />
              </div>
            )}
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
