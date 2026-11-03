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
  // 'pending' = show Approve+Reject; 'retry' = show only Resend payment link
  mode?: 'pending' | 'retry'
}) {
  const router = useRouter()
  const toast = useActionToast()
  const [showReject, setShowReject] = useState(false)
  const [note, setNote] = useState('')

  // Approve, or re-run subscription creation for an approved store whose Razorpay step failed.
  async function approve(retry: boolean) {
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/approve`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok || !data?.ok) return toast.error(data?.error || 'Failed')
    toast.success(retry && !data.provisioningStarted ? 'Payment link generated; the owner can pay now.' : approvedMessage(data))
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

  if (mode === 'retry') return <ActionButton variant="primary" action={{ label: 'Resend payment link', icon: Send, onClick: () => approve(true) }} />

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
    <div className="flex flex-wrap gap-2">
      <ActionButton action={{ label: 'Reject', icon: X, danger: true, onClick: () => setShowReject(true) }} />
      <ActionButton variant="primary" action={{ label: 'Approve', icon: Check, onClick: () => approve(false) }} />
    </div>
  )
}

// Payments off: approval starts the build directly (no checkout link exists).
function approvedMessage(data: { provisioningStarted?: boolean; paymentBypassed?: boolean }): string {
  return data.provisioningStarted || data.paymentBypassed ? 'Approved: store setup started.' : 'Approved: payment link sent to owner.'
}
