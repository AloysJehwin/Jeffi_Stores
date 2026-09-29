'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'

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

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn by customer',
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function AddressCard({ title, address, highlight }: { title: string; address: Address | null; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">{title}</p>
      {address ? (
        <div className="text-sm text-foreground-secondary">
          <p className="font-semibold text-foreground">{address.full_name}</p>
          <p>{address.address_line1}{address.address_line2 ? `, ${address.address_line2}` : ''}</p>
          {address.landmark && <p>Landmark: {address.landmark}</p>}
          <p>{address.city}, {address.state} {address.postal_code}</p>
          <p>Phone: {address.phone}</p>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">Not available</p>
      )}
    </div>
  )
}

export default function AddressChangeReview({ orderId, requests, canWrite: canWriteProp, blockReason }: {
  orderId: string
  requests: AddressChangeRequestView[]
  canWrite: boolean
  blockReason: string | null
}) {
  const router = useRouter()
  const canWrite = useCanWrite('orders') && canWriteProp
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const pending = requests.find(r => r.status === 'pending') ?? null
  const history = requests.filter(r => r.status !== 'pending')

  const review = async (action: 'approve' | 'reject') => {
    if (!pending || !canWrite) return
    if (action === 'reject' && !rejectNote.trim()) return
    setIsProcessing(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/address-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: pending.id, action, adminNotes: action === 'reject' ? rejectNote.trim() : undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to review the address change request')
      setResult({
        type: 'success',
        message: action === 'approve'
          ? `Address change approved. The order now ships to the new address.${data.gstSplitChanged ? ' The GST split was recalculated for the new state.' : ''}`
          : 'Address change rejected. The customer has been notified with your reason.',
      })
      setTimeout(() => router.refresh(), 1500)
    } catch (err: any) {
      setResult({ type: 'error', message: err.message })
    } finally {
      setIsProcessing(false)
    }
  }

  if (requests.length === 0) return null

  const stateChanges = !!pending?.oldAddress && norm(pending.oldAddress.state) !== norm(pending.newAddress.state)
  const pinChanges = !!pending?.oldAddress && norm(pending.oldAddress.postal_code) !== norm(pending.newAddress.postal_code)

  return (
    <div className={`bg-surface-elevated rounded-lg shadow-sm ${pending ? 'border-2 border-orange-300 dark:border-orange-800' : 'border border-border-default'}`}>
      <div className={`px-6 py-4 border-b ${pending ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30' : 'border-border-default'}`}>
        <h2 className={`text-lg font-semibold ${pending ? 'text-orange-900 dark:text-orange-300' : 'text-foreground'}`}>
          {pending ? 'Delivery Address Change Request' : 'Delivery Address Changes'}
        </h2>
      </div>
      <div className="p-4 sm:p-6 space-y-4">
        {result && (
          <div className={`px-4 py-3 rounded-lg text-sm ${
            result.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}>
            {result.message}
          </div>
        )}

        {pending && (
          <>
            <p className="text-foreground-secondary text-sm">
              The customer asked on {fmtDate(pending.createdAt)} to deliver this order to a different address. The order address changes only if you approve.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AddressCard title="Current delivery address" address={pending.oldAddress} />
              <AddressCard title="Requested delivery address" address={pending.newAddress} highlight />
            </div>

            {(stateChanges || pinChanges) && (
              <ul className="text-sm text-foreground-secondary list-disc pl-5 space-y-1">
                {pinChanges && (
                  <li>
                    Pincode changes from {pending.oldAddress?.postal_code} to {pending.newAddress.postal_code}. Shipping was charged for the original pincode and is not re-charged; the delivery estimate is adjusted on approval.
                  </li>
                )}
                {stateChanges && (
                  <li>
                    Delivery state changes from {pending.oldAddress?.state} to {pending.newAddress.state}. If that crosses your state boundary, the CGST/SGST and IGST split on this order is recalculated on approval. Order totals do not change.
                  </li>
                )}
              </ul>
            )}

            {blockReason && (
              <p className="text-sm text-red-700 dark:text-red-400">
                This request can no longer be approved: {blockReason} You can still reject it to close it.
              </p>
            )}

            {!canWrite ? (
              <p className="text-sm text-foreground-muted">Read-only access — cannot approve or reject.</p>
            ) : showRejectForm ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="e.g. We cannot deliver to this location for this order."
                    className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent resize-none"
                    disabled={isProcessing}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => review('reject')}
                    disabled={isProcessing || !rejectNote.trim()}
                    className="px-4 py-2 bg-secondary-600 hover:bg-secondary-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Sending...' : 'Confirm Rejection'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRejectForm(false); setRejectNote('') }}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors disabled:opacity-50"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                {!blockReason && (
                  <button
                    type="button"
                    onClick={() => review('approve')}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Processing...' : 'Approve Address Change'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRejectForm(true)}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-surface-elevated hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium text-sm border border-border-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reject (Keep Address)
                </button>
              </div>
            )}
          </>
        )}

        {history.length > 0 && (
          <div className={pending ? 'pt-4 border-t border-border-default' : ''}>
            {pending && <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Earlier requests</p>}
            <ul className="space-y-2">
              {history.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-secondary">
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  <span>{r.newAddress.city}, {r.newAddress.state} {r.newAddress.postal_code}</span>
                  <span className="text-foreground-muted">{fmtDate(r.reviewedAt || r.createdAt)}</span>
                  {r.adminNotes && <span className="w-full text-foreground-muted">Note: {r.adminNotes}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
