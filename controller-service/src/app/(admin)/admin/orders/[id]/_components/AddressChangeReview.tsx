'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit/toast'
import { TextArea } from '@/components/admin/kit/form'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import { Card } from '@/components/admin/kit/layout'
import { badgeCls, type Tone } from '@/components/admin/kit/tones'

interface Address {
  full_name: string
  phone: string
  address_line1: string
  address_line2: string | null
  landmark: string | null
  city: string
  state: string
  postal_code: string
}

export interface AddressChangeRequestView {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  oldAddress: Address | null
  newAddress: Address
  adminNotes: string | null
  createdAt: string
  reviewedAt: string | null
}

const STATUS_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'muted' }
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn by customer',
}

const norm = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function AddressCard({ title, address, highlight }: { title: string; address: Address | null; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${highlight ? 'border-accent-500/50 bg-accent-500/5' : 'border-border-default'}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">{title}</p>
      {address ? (
        <div className="text-sm text-foreground-secondary">
          <p className="font-semibold text-foreground">{address.full_name}</p>
          <p>
            {address.address_line1}
            {address.address_line2 ? `, ${address.address_line2}` : ''}
          </p>
          {address.landmark && <p>Landmark: {address.landmark}</p>}
          <p>
            {address.city}, {address.state} {address.postal_code}
          </p>
          <p>Phone: {address.phone}</p>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Not available</p>
      )}
    </div>
  )
}

export default function AddressChangeReview({
  orderId,
  requests,
  canWrite: canWriteProp,
  blockReason,
}: {
  orderId: string
  requests: AddressChangeRequestView[]
  canWrite: boolean
  blockReason: string | null
}) {
  const router = useRouter()
  const canWrite = useCanWrite('orders') && canWriteProp
  const [isProcessing, setIsProcessing] = useState(false)
  const toast = useActionToast()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const pending = requests.find(r => r.status === 'pending') ?? null
  const history = requests.filter(r => r.status !== 'pending')

  const review = async (action: 'approve' | 'reject') => {
    if (!pending || !canWrite) return
    if (action === 'reject' && !rejectNote.trim()) return
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/address-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pending.id,
          action,
          adminNotes: action === 'reject' ? rejectNote.trim() : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to review the address change request')
      toast.success(
        action === 'approve'
          ? `Address change approved. The order now ships to the new address.${data.gstSplitChanged ? ' The GST split was recalculated for the new state.' : ''}`
          : 'Address change rejected. The customer has been notified with your reason.'
      )
      setTimeout(() => router.refresh(), 1500)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  if (requests.length === 0) return null

  const stateChanges = !!pending?.oldAddress && norm(pending.oldAddress.state) !== norm(pending.newAddress.state)
  const pinChanges =
    !!pending?.oldAddress && norm(pending.oldAddress.postal_code) !== norm(pending.newAddress.postal_code)

  return (
    <Card
      title={
        <span className={pending ? 'text-amber-600 dark:text-amber-400' : ''}>
          {pending ? 'Delivery Address Change Request' : 'Delivery Address Changes'}
        </span>
      }
    >
      <div className="space-y-4">

        {pending && (
          <>
            <p className="text-foreground-secondary text-sm">
              The customer asked on {fmtDate(pending.createdAt)} to deliver this order to a different address. The order
              address changes only if you approve.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AddressCard title="Current delivery address" address={pending.oldAddress} />
              <AddressCard title="Requested delivery address" address={pending.newAddress} highlight />
            </div>

            {(stateChanges || pinChanges) && (
              <ul className="text-sm text-foreground-secondary list-disc pl-5 space-y-1">
                {pinChanges && (
                  <li>
                    Pincode changes from {pending.oldAddress?.postal_code} to {pending.newAddress.postal_code}. Shipping
                    was charged for the original pincode and is not re-charged; the delivery estimate is adjusted on
                    approval.
                  </li>
                )}
                {stateChanges && (
                  <li>
                    Delivery state changes from {pending.oldAddress?.state} to {pending.newAddress.state}. If that
                    crosses your state boundary, the CGST/SGST and IGST split on this order is recalculated on approval.
                    Order totals do not change.
                  </li>
                )}
              </ul>
            )}

            {blockReason && (
              <p className="text-sm text-red-600 dark:text-red-400">
                This request can no longer be approved: {blockReason} You can still reject it to close it.
              </p>
            )}

            {!canWrite ? (
              <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>
            ) : showRejectForm ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <AIEnrichButton
                    fieldLabel="Reason for rejecting the address change"
                    value={rejectNote}
                    onChange={setRejectNote}
                    scope="orders:write"
                    maxLength={1000}
                    multiline
                    context="Sent to the customer explaining why their delivery address change request was declined. Polite, brief, factual."
                  >
                    <TextArea
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="e.g. We cannot deliver to this location for this order."
                      className="resize-none pr-8"
                      disabled={isProcessing}
                    />
                  </AIEnrichButton>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => review('reject')}
                    disabled={isProcessing || !rejectNote.trim()}
                    className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isProcessing ? 'Sending...' : 'Confirm Rejection'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRejectForm(false)
                      setRejectNote('')
                    }}
                    disabled={isProcessing}
                    className="control-md border border-border-secondary font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!blockReason && (
                  <button
                    type="button"
                    onClick={() => review('approve')}
                    disabled={isProcessing}
                    className="control-md bg-green-600 font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isProcessing ? 'Processing...' : 'Approve Address Change'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRejectForm(true)}
                  disabled={isProcessing}
                  className="control-md border border-border-secondary font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  Reject (Keep Address)
                </button>
              </div>
            )}
          </>
        )}

        {history.length > 0 && (
          <div className={pending ? 'pt-4 border-t border-border-default' : ''}>
            {pending && (
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                Earlier requests
              </p>
            )}
            <ul className="space-y-2">
              {history.map(r => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-secondary"
                >
                  <span className={badgeCls(STATUS_TONE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  <span>
                    {r.newAddress.city}, {r.newAddress.state} {r.newAddress.postal_code}
                  </span>
                  <span className="text-foreground-muted">{fmtDate(r.reviewedAt || r.createdAt)}</span>
                  {r.adminNotes && <span className="w-full text-foreground-muted">Note: {r.adminNotes}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
