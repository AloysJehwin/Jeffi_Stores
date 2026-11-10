'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { Badge, Card } from '@/components/admin/kit'
import { useActionToast } from '@/components/admin/kit/toast'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A UTR the customer submitted for this order: approve it against the bank statement (marks the order paid) or reject it. */
export default function UpiConfirmationCard({ intentId, utr, submittedAt, amountPaise }: { intentId: string; utr: string | null; submittedAt: string | null; amountPaise: number }) {
  const router = useRouter()
  const toast = useActionToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('financial:write')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  async function decide(action: 'approve' | 'reject') {
    const ok = await confirm({
      title: action === 'approve' ? 'Approve UPI payment' : 'Reject UPI payment',
      message:
        action === 'approve'
          ? `Approve only after you find ${inr(amountPaise)}${utr ? ` with UTR ${utr}` : ''} in your bank statement. The order is marked paid.`
          : 'Reject this UTR? The order stays unpaid and the customer can pay again.',
      confirmLabel: action === 'approve' ? 'Approve' : 'Reject',
      variant: action === 'reject' ? 'danger' : 'default',
    })
    if (!ok) return
    setBusy(action)
    try {
      const res = await fetch(`/api/admin/payments/upi/${encodeURIComponent(intentId)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update the payment')
      toast.success(action === 'approve' ? `Payment of ${inr(amountPaise)} approved.` : 'UTR rejected.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the payment')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title="UPI payment to confirm"
      action={<Badge tone="amber">Awaiting confirmation</Badge>}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm">
          <p className="text-foreground">
            The customer says they paid <span className="font-semibold">{inr(amountPaise)}</span> by UPI
            {utr ? (
              <>
                {' '}with UTR <span className="font-mono font-medium">{utr}</span>
              </>
            ) : null}
            .
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            {submittedAt ? `Submitted ${new Date(submittedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. ` : ''}
            Match it with your bank statement before approving. The order is not cancelled automatically while this is open.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button type="button" onClick={() => decide('reject')} disabled={!!busy} className="control-md border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400">
              <X className="h-4 w-4" /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
            <button type="button" onClick={() => decide('approve')} disabled={!!busy} className="control-md bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-60">
              <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </Card>
  )
}
