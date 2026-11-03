'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AdminSelect from '@/components/admin/AdminSelect'
import BatchPickerModal, { BatchPickerItem, BatchAssignment } from '@/components/admin/BatchPickerModal'
import SerialEntryModal, { SerialItem, SerialAssignment } from '@/components/admin/SerialEntryModal'
import Toggle from '@/components/ui/Toggle'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit/toast'

interface UpdateOrderStatusProps {
  orderId: string
  currentStatus: string
  currentPaymentStatus: string
  canOverride?: boolean
  inventoryValidationEnabled?: boolean
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancel_requested', 'cancelled'],
  confirmed: ['processing', 'cancel_requested', 'cancelled'],
  processing: ['shipped', 'cancel_requested'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: [],
  granted: [],
  cancel_requested: ['cancelled', 'cancel_rejected'],
  cancel_rejected: [],
  cancelled: [],
}

const VALID_PAYMENT_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'failed'],
  unpaid: ['paid', 'failed'],
  paid: ['refunded'],
  failed: ['paid', 'pending'],
  refunded: [],
  cod_pending: ['cod_collected', 'failed'],
  cod_collected: ['paid', 'refunded'],
}

const PAYMENT_ALLOWED_FOR_STATUS: Record<string, string[]> = {
  pending: ['pending', 'unpaid', 'cod_pending', 'failed'],
  confirmed: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  processing: ['paid', 'unpaid', 'cod_pending'],
  shipped: ['paid', 'cod_pending', 'cod_collected'],
  out_for_delivery: ['paid', 'cod_pending', 'cod_collected'],
  delivered: ['paid', 'cod_collected'],
  granted: ['paid', 'refunded'],
  cancel_requested: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  cancel_rejected: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  cancelled: ['paid', 'pending', 'unpaid', 'failed', 'refunded'],
}

const ALL_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'granted', label: 'Access granted' },
  { value: 'cancel_requested', label: 'Cancel Requested' },
  { value: 'cancel_rejected', label: 'Cancel Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

const ALL_PAYMENT_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'cod_pending', label: 'COD Pending' },
  { value: 'cod_collected', label: 'COD Collected' },
]

// Reachable only by override — the normal flow never offers these, but a super admin
// correcting a mis-set order needs them selectable.
const OVERRIDE_ONLY_STATUS_OPTIONS = [
  { value: 'return_requested', label: 'Return Requested' },
  { value: 'return_approved', label: 'Return Approved' },
  { value: 'return_received', label: 'Return Received' },
  { value: 'return_rejected', label: 'Return Rejected' },
  { value: 'returned', label: 'Returned' },
]

const MIN_REASON = 10

export default function UpdateOrderStatus({
  orderId,
  currentStatus,
  currentPaymentStatus,
  canOverride = false,
  inventoryValidationEnabled = true,
}: UpdateOrderStatusProps) {
  const [status, setStatus] = useState(currentStatus)
  const [paymentStatus, setPaymentStatus] = useState(currentPaymentStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const toast = useActionToast()
  // Validation shown under the fields; action responses go to toasts.
  const [error, setError] = useState<string | null>(null)
  const [paymentAutoResetNote, setPaymentAutoResetNote] = useState<string | null>(null)
  const [batchPickerItems, setBatchPickerItems] = useState<BatchPickerItem[] | null>(null)
  const [serialPickerItems, setSerialPickerItems] = useState<SerialItem[] | null>(null)
  const [pendingBatchAssignments, setPendingBatchAssignments] = useState<BatchAssignment[] | null>(null)
  const [pendingPaymentStatus, setPendingPaymentStatus] = useState<string | null>(null)
  const router = useRouter()

  const [overrideMode, setOverrideMode] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const canWrite = useCanWrite('orders:write')

  const allowedStatuses = [currentStatus, ...(VALID_STATUS_TRANSITIONS[currentStatus] ?? [])]
  const allowedPaymentStatuses = [currentPaymentStatus, ...(VALID_PAYMENT_TRANSITIONS[currentPaymentStatus] ?? [])]

  const statusOptions = overrideMode
    ? [...ALL_STATUS_OPTIONS, ...OVERRIDE_ONLY_STATUS_OPTIONS]
    : ALL_STATUS_OPTIONS.filter(o => allowedStatuses.includes(o.value))
  const allowedForStatus = PAYMENT_ALLOWED_FOR_STATUS[status] ?? []
  const paymentOptions = overrideMode
    ? ALL_PAYMENT_OPTIONS
    : ALL_PAYMENT_OPTIONS.filter(o => allowedPaymentStatuses.includes(o.value) && allowedForStatus.includes(o.value))

  useEffect(() => {
    if (overrideMode) {
      setPaymentAutoResetNote(null)
      return
    }
    const allowed = PAYMENT_ALLOWED_FOR_STATUS[status] ?? []
    if (!allowed.includes(paymentStatus)) {
      const firstValid = allowedPaymentStatuses.find(ps => allowed.includes(ps))
      if (firstValid) {
        setPaymentStatus(firstValid)
        setPaymentAutoResetNote(
          `Payment status reset to "${firstValid}" — not compatible with order status "${status}".`
        )
      }
    } else {
      setPaymentAutoResetNote(null)
    }
  }, [status, overrideMode])

  const crossFieldError =
    !overrideMode && !(PAYMENT_ALLOWED_FOR_STATUS[status] ?? []).includes(paymentStatus)
      ? `Payment status "${paymentStatus}" is not valid for an order in "${status}" status.`
      : null

  const reasonTooShort = overrideMode && overrideReason.trim().length < MIN_REASON

  async function handleUpdate() {
    if (crossFieldError) {
      setError(crossFieldError)
      return
    }
    if (reasonTooShort) {
      setError(`Give a reason of at least ${MIN_REASON} characters — it is recorded in the audit log.`)
      return
    }

    // Batch/serial assignment is part of the normal fulfilment path. An override is a
    // correction of record, so it writes the status straight through without prompting.
    // Skipped entirely when inventory validation is off (e.g. basic plan) — there is no
    // stock to reconcile, and the server won't validate or decrement either.
    if (inventoryValidationEnabled && !overrideMode && status === 'processing' && currentStatus !== 'processing') {
      setIsUpdating(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/inventory/batches/available?order_id=${orderId}`)
        if (!res.ok) throw new Error('Failed to load batch information')
        const data = await res.json()
        const hasBatchItems = data.items && data.items.length > 0
        const hasSerialItems = data.serialized_items && data.serialized_items.length > 0
        if (hasBatchItems || hasSerialItems) {
          setPendingPaymentStatus(paymentStatus)
          if (hasSerialItems) setSerialPickerItems(data.serialized_items)
          if (hasBatchItems) {
            setBatchPickerItems(data.items)
          } else {
            // Only serialized — go straight to serial entry (batch picker skipped)
          }
          setIsUpdating(false)
          return
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to check batch availability')
        setIsUpdating(false)
        return
      }
      setIsUpdating(false)
    }

    await submitUpdate(null)
  }

  async function submitUpdate(
    batchAssignments: BatchAssignment[] | null,
    serialAssignments?: SerialAssignment[] | null
  ) {
    setIsUpdating(true)
    setError(null)

    try {
      const body: Record<string, any> = { status, payment_status: pendingPaymentStatus ?? paymentStatus }
      if (overrideMode) {
        body.override = true
        body.override_reason = overrideReason.trim()
      }
      if (batchAssignments && batchAssignments.length > 0) {
        body.batch_assignments = batchAssignments
      }
      if (serialAssignments && serialAssignments.length > 0) {
        body.serial_assignments = serialAssignments
      }

      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update order')
      }

      const data = await response.json()

      let successMessage = 'Order updated successfully'
      if (data.notifications) {
        const emailsSent = []
        if (data.notifications.statusEmailSent) emailsSent.push('order status')
        if (data.notifications.paymentEmailSent) emailsSent.push('payment status')
        if (emailsSent.length > 0) {
          successMessage += `. Email notification sent for ${emailsSent.join(' and ')} update.`
        }
      }

      toast.success(successMessage)
      setPaymentAutoResetNote(null)
      setPendingPaymentStatus(null)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message || 'Failed to update order. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const hasChanges = status !== currentStatus || paymentStatus !== currentPaymentStatus

  const isTerminal =
    VALID_STATUS_TRANSITIONS[currentStatus]?.length === 0 &&
    VALID_PAYMENT_TRANSITIONS[currentPaymentStatus]?.length === 0

  if (!canWrite) {
    return <p className="text-sm text-foreground-muted">You do not have permission to modify this order.</p>
  }

  if (isTerminal && !canOverride) {
    return <p className="text-sm text-foreground-muted">This order is in a terminal state and cannot be modified.</p>
  }

  if (isTerminal && !overrideMode) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground-muted">
          This order is in a terminal state and cannot be modified through the normal flow.
        </p>
        <button
          type="button"
          onClick={() => setOverrideMode(true)}
          className="text-sm font-medium text-amber-700 underline underline-offset-4 hover:text-amber-600 dark:text-amber-400"
        >
          Override status
        </button>
      </div>
    )
  }

  return (
    <>
      {batchPickerItems && (
        <BatchPickerModal
          items={batchPickerItems}
          onConfirm={assignments => {
            setBatchPickerItems(null)
            if (serialPickerItems) {
              // Chain: batch done → now collect serials
              setPendingBatchAssignments(assignments)
            } else {
              submitUpdate(assignments)
            }
          }}
          onCancel={() => {
            setBatchPickerItems(null)
            setPendingPaymentStatus(null)
            setPendingBatchAssignments(null)
            setIsUpdating(false)
          }}
        />
      )}

      {serialPickerItems && !batchPickerItems && (
        <SerialEntryModal
          items={serialPickerItems}
          onConfirm={assignments => {
            setSerialPickerItems(null)
            submitUpdate(pendingBatchAssignments, assignments)
          }}
          onCancel={() => {
            setSerialPickerItems(null)
            setPendingPaymentStatus(null)
            setPendingBatchAssignments(null)
            setIsUpdating(false)
          }}
        />
      )}

      <div className="space-y-4">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {paymentAutoResetNote && (
          <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm text-foreground">{paymentAutoResetNote}</div>
        )}

        {canOverride && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">Override</div>
              <p className="mt-0.5 text-xs text-foreground-muted">
                Set any status, ignoring the normal transition rules. Recorded in the audit log.
              </p>
            </div>
            <div className="shrink-0 pt-0.5">
              <Toggle
                checked={overrideMode}
                onChange={on => {
                  setOverrideMode(on)
                  setError(null)
                  setPaymentAutoResetNote(null)
                }}
              />
            </div>
          </div>
        )}

        {overrideMode && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground-secondary">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={overrideReason}
              onChange={e => {
                setOverrideReason(e.target.value)
                setError(null)
              }}
              rows={2}
              placeholder="Why is this override necessary? Recorded against your admin account."
              className="field-md w-full resize-none border border-border-secondary bg-surface py-2 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-xs text-foreground-muted">
              {overrideReason.trim().length}/{MIN_REASON} minimum
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AdminSelect
            id="status"
            label="Order Status"
            value={status}
            onChange={val => {
              setStatus(val)
              setError(null)
            }}
            options={statusOptions}
          />

          <AdminSelect
            id="payment_status"
            label="Payment Status"
            value={paymentStatus}
            onChange={val => {
              setPaymentStatus(val)
              setError(null)
              setPaymentAutoResetNote(null)
            }}
            options={paymentOptions}
          />
        </div>

        {crossFieldError && <p className="text-sm text-red-600 dark:text-red-400">{crossFieldError}</p>}

        <button
          type="button"
          onClick={handleUpdate}
          disabled={isUpdating || !hasChanges || !!crossFieldError || reasonTooShort}
          className={`control-md w-full justify-center font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
            overrideMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent-500 hover:bg-accent-600'
          }`}
        >
          {isUpdating ? 'Updating...' : overrideMode ? 'Override Order Status' : 'Update Order'}
        </button>
      </div>
    </>
  )
}
