'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send, X } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'

export default function KycActionButtons({
  tenantId,
  mode = 'pending',
}: {
  tenantId: string
  // 'pending' = show Approve+Reject; 'retry' = an approved Mandatory store with no payment link: retry it, or switch to Optional
  mode?: 'pending' | 'retry'
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [showReject, setShowReject] = useState(false)
  const [note, setNote] = useState('')
  const [paymentRequired, setPaymentRequired] = useState(true)

  // Approve, or re-run it for an approved store whose Razorpay step failed.
  async function approve(retry: boolean) {
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentRequired }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok || !data?.ok) return toast.error(data?.error || 'Failed')
    toast.success(approvedMessage(data, retry))
    router.refresh()
  }

  async function reject() {
    if (!note.trim()) return toast.error('Enter a reason for the rejection.')
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed')
    router.refresh()
  }

  const choice = <PaymentChoice value={paymentRequired} onChange={setPaymentRequired} />

  if (mode === 'retry') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {choice}
        <ActionButton
          variant="primary"
          action={
            paymentRequired
              ? { label: 'Resend payment link', icon: Send, onClick: () => approve(true) }
              : {
                  label: 'Start build',
                  icon: Check,
                  onClick: () => approve(true),
                  confirm: { title: 'Start the build without payment?', message: 'The store becomes payment optional: its build starts now and no checkout link is sent.', confirmLabel: 'Start build' },
                }
          }
        />
      </div>
    )
  }

  if (showReject) {
    return (
      <div className="flex w-full flex-col gap-2 sm:w-80">
        <textarea
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-400"
          placeholder="Reason for rejection (shown to owner)…"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <ActionButton action={{ label: 'Confirm reject', icon: X, danger: true, onClick: reject, disabled: !note.trim() }} />
          <ActionButton action={{ label: 'Cancel', onClick: () => setShowReject(false) }} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {choice}
      <ActionButton action={{ label: 'Reject', icon: X, danger: true, onClick: () => setShowReject(true) }} />
      <ActionButton
        variant="primary"
        action={{
          label: 'Approve',
          icon: Check,
          onClick: () => approve(false),
          confirm: paymentRequired
            ? {
                title: 'Approve with payment mandatory?',
                message: 'We create the Razorpay subscription and email the owner a checkout link. The build starts when their first payment lands.',
                confirmLabel: 'Approve',
              }
            : { title: 'Approve with payment optional?', message: 'The build starts now. No checkout link is sent and nothing is charged.', confirmLabel: 'Approve' },
        }}
      />
    </div>
  )
}

/** Payment: Mandatory | Optional, one control tall so it lines up with the buttons beside it. */
function PaymentChoice({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const option = (v: boolean, label: string, hint: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      title={hint}
      onClick={() => onChange(v)}
      className={`h-full rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
        value === v ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:bg-surface-secondary hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Payment" className="inline-flex h-control items-center gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
      <span className="px-1.5 text-xs text-foreground-muted">Payment</span>
      {option(true, 'Mandatory', 'Checkout link; the first payment starts the build')}
      {option(false, 'Optional', 'The build starts on approval; no checkout')}
    </div>
  )
}

// Mandatory answers with a checkout link; Optional starts the build.
function approvedMessage(data: { checkoutUrl?: string }, retry: boolean): string {
  if (data.checkoutUrl) return retry ? 'Payment link generated; the owner can pay now.' : 'Approved: payment link sent to owner.'
  return retry ? 'Build started; payment is optional for this store.' : 'Approved with payment optional: store setup started.'
}
