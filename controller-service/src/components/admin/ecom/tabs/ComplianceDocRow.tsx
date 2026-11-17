'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'

const link = 'text-accent-600 hover:underline text-xs whitespace-nowrap'

/** One licence on the KYC tab: approve or reject it with an optional note the owner sees; a lapsed one can only be rejected. */
export default function ComplianceDocRow({
  tenantId,
  docId,
  version,
  name,
  pending,
  lapsed,
  badge,
  detail,
  review,
  href,
}: {
  tenantId: string
  docId: string
  /** The file shown (its S3 key): a copy the owner sends meanwhile is not decided unseen. */
  version: string
  name: string
  /** Not reviewed yet. */
  pending: boolean
  /** Past its date: only the renewed one the owner sends can be approved. */
  lapsed: boolean
  badge: ReactNode
  detail: ReactNode
  /** Who decided and when, with the note. */
  review?: ReactNode
  href: string
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  async function decide(decision: 'approved' | 'rejected') {
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/doc/${docId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note: note.trim() || undefined, version }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed')
    toast.success(`${name}: ${decision}.`)
    setOpen(false)
    setNote('')
    router.refresh()
  }

  return (
    <li className="py-2.5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground break-words">{name}</div>
          <div className="text-xs text-foreground-muted break-words">{detail}</div>
          {review && <div className="mt-0.5 text-xs text-foreground-muted break-words">{review}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge}
          <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
            View ↗
          </a>
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className={link}>
              {pending ? 'Review' : 'Change'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Note to the owner (optional)"
            aria-label={`Note on the ${name}`}
            className="field-md min-w-0 flex-1 basis-56 border border-border-default bg-surface text-foreground"
          />
          <ActionButton variant="primary" action={{ label: 'Approve', icon: Check, disabled: lapsed, onClick: () => decide('approved') }} />
          <ActionButton action={{ label: 'Reject', icon: X, danger: true, onClick: () => decide('rejected') }} />
          <ActionButton
            action={{
              label: 'Cancel',
              onClick: () => {
                setOpen(false)
                setNote('')
              },
            }}
          />
          {lapsed && <p className="basis-full text-xs text-foreground-muted">It has expired: only the renewed one the owner sends can be approved.</p>}
        </div>
      )}
    </li>
  )
}
