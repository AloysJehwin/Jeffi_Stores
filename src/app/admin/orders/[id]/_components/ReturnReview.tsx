'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'

interface ReturnRequest {
  id: string
  type: 'refund' | 'replacement'
  status: string
  reason: string
  description?: string | null
  admin_notes?: string | null
  return_tracking_number?: string | null
  replacement_order_id?: string | null
  rvp_awb_number?: string | null
  rvp_delivery_charge?: number | string | null
  valuation_status?: string | null
  valuation_condition?: string | null
  valuation_notes?: string | null
  created_at: string
  items?: Array<{
    id: string
    product_name?: string | null
    variant_name?: string | null
    quantity: number
    unit_price: number
    refund_amount: number
  }> | null
}

interface ReturnReviewProps {
  orderId: string
  returnRequest: ReturnRequest
  replacementOrderNumber?: string | null
}

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective product',
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

export default function ReturnReview({ orderId, returnRequest, replacementOrderNumber }: ReturnReviewProps) {
  const canWrite = useCanWrite('returns:write')
  const [adminNotes, setAdminNotes] = useState('')
  const [returnTrackingNumber, setReturnTrackingNumber] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [refundFailed, setRefundFailed] = useState(false)
  const [stockWarning, setStockWarning] = useState<string | null>(null)
  // Replacement variant picker: when the original variant/sub-variant of a
  // replacement item no longer exists, the process API returns 409 with the list of
  // items needing a pick (+ the product's active grains). We render dropdowns and
  // resubmit with the chosen grains.
  const [variantPick, setVariantPick] = useState<any[] | null>(null)
  const [pickSelections, setPickSelections] = useState<Record<string, string>>({})
  // Return destination: which warehouse the RVP is directed to.
  const [warehouses, setWarehouses] = useState<{ value: string; label: string }[]>([])
  const [pickupLocation, setPickupLocation] = useState('')
  // RVP delivery charge: reverse legs have no customer quote, so the admin enters it here; saving
  // debits the tenant wallet keyed to the RVP AWB.
  const [rvpCharge, setRvpCharge] = useState(
    returnRequest.rvp_delivery_charge != null ? String(returnRequest.rvp_delivery_charge) : ''
  )
  const [rvpChargeSaving, setRvpChargeSaving] = useState(false)
  const [rvpChargeMsg, setRvpChargeMsg] = useState<string | null>(null)
  const router = useRouter()

  async function handleSaveRvpCharge() {
    const amount = Number(rvpCharge)
    if (!(amount >= 0) || !Number.isFinite(amount)) { setRvpChargeMsg('Enter a valid amount.'); return }
    setRvpChargeSaving(true)
    setRvpChargeMsg(null)
    try {
      const res = await fetch(`/api/admin/returns/${returnRequest.id}/rvp-charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charge: amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save charge')
      setRvpChargeMsg(data.walletWarning ? `Saved. ${data.walletWarning}` : 'Charge saved and applied to the wallet.')
      router.refresh()
    } catch (e: any) {
      setRvpChargeMsg(e.message)
    } finally {
      setRvpChargeSaving(false)
    }
  }

  useEffect(() => {
    fetch('/api/admin/delhivery/pickup-locations')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const opts = Array.isArray(d?.locations)
          ? d.locations.map((w: { name: string }) => ({ value: w.name, label: w.name }))
          : []
        setWarehouses(opts)
        if (opts.length > 0) setPickupLocation((prev) => prev || opts[0].value)
      })
      .catch(() => {})
  }, [])

  async function handleCreateRVP() {
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/create-rvp-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickupLocation ? { pickupLocation } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSuccess(`RVP shipment created. AWB: ${data.awb}`)
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submit(action: string, replacementVariants?: Record<string, { variant_id: string | null; sub_variant_id: string | null }>) {
    if (action === 'reject' && !adminNotes.trim()) {
      setError('Please provide a reason for rejection.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    setRefundFailed(false)
    setStockWarning(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/return-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          adminNotes: adminNotes.trim() || undefined,
          returnTrackingNumber: returnTrackingNumber.trim() || undefined,
          ...(action === 'process' ? { restock: returnRequest.valuation_condition === 'good' } : {}),
          ...(replacementVariants ? { replacementVariants } : {}),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        // Replacement item(s) need a variant pick — surface the inline picker.
        if (response.status === 409 && data.error === 'variant_pick_required' && Array.isArray(data.needsVariantPick)) {
          setVariantPick(data.needsVariantPick)
          setError('The original variant for one or more items no longer exists. Choose a replacement variant below.')
          return
        }
        throw new Error(data.error || 'Failed')
      }

      // Success — clear any picker state.
      setVariantPick(null)
      setPickSelections({})

      if (action === 'process' && Array.isArray(data.stockWarnings) && data.stockWarnings.length > 0) {
        setStockWarning(
          `Stock was NOT restored for ${data.stockWarnings.length} item(s) — the variant/sub-variant no longer exists or is inactive. The return was still processed.`
        )
      }

      if (action === 'process' && data.refundFailed) {
        setRefundFailed(true)
        setSuccess('Return marked as resolved. Note: Razorpay refund could not be initiated automatically — please issue it manually.')
      } else if (action === 'approve') {
        setSuccess('Return request approved. Customer notified.')
      } else if (action === 'reject') {
        setSuccess('Return request rejected. Customer notified.')
      } else if (action === 'mark_received') {
        setSuccess('Item marked as received. Customer notified.')
      } else if (action === 'process') {
        if (data.replacementOrderNumber) {
          setSuccess(`Replacement order #${data.replacementOrderNumber} created. Customer notified.`)
        } else if (typeof data.netRefund === 'number' && data.netRefund <= 0 && Number(data.charge) > 0) {
          setSuccess(
            `No refund issued — the ₹${Number(data.charge).toFixed(0)} return charge covers the ₹${Number(data.grossRefund).toFixed(0)} returnable amount. The item was accepted and restocked.`
          )
        } else if (typeof data.netRefund === 'number' && Number(data.charge) > 0) {
          setSuccess(
            `Refund of ₹${Number(data.netRefund).toFixed(0)} processed (₹${Number(data.grossRefund).toFixed(0)} less ₹${Number(data.charge).toFixed(0)} return charge). Customer notified.`
          )
        } else {
          setSuccess('Refund processed. Customer notified.')
        }
      }

      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const { status, type, reason, description, admin_notes, return_tracking_number } = returnRequest

  // Build the replacementVariants map from picker selections and resubmit process.
  function confirmVariantPick() {
    if (!variantPick) return
    const map: Record<string, { variant_id: string | null; sub_variant_id: string | null }> = {}
    for (const it of variantPick) {
      const sel = pickSelections[it.order_item_id]
      if (!sel) { setError('Please choose a replacement variant for every item.'); return }
      // Encoded value: "variantId|subVariantId" (subVariantId may be empty).
      const [vid, svid] = sel.split('|')
      map[it.order_item_id] = { variant_id: vid || null, sub_variant_id: svid || null }
    }
    submit('process', map)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className={`p-3 border rounded-lg text-sm ${refundFailed ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300' : 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'}`}>
          {success}
        </div>
      )}
      {stockWarning && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-sm">
          ⚠ {stockWarning}
        </div>
      )}
      {variantPick && variantPick.length > 0 && canWrite && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Choose replacement variant(s)</p>
          {variantPick.map((it: any) => (
            <div key={it.order_item_id} className="space-y-1">
              <p className="text-xs text-foreground-muted">
                {it.product_name}{it.variant_name ? ` — original: ${it.variant_name}` : ''} (no longer available)
              </p>
              <AdminSelect
                sm
                value={pickSelections[it.order_item_id] || ''}
                onChange={v => setPickSelections(s => ({ ...s, [it.order_item_id]: v }))}
                placeholder="Select a variant to ship…"
                className="w-full"
                options={(it.options || []).map((o: any) => ({
                  value: `${o.variant_id}|${o.sub_variant_id || ''}`,
                  label: `${o.label}${o.sku ? ` (${o.sku})` : ''}${o.stock_status ? ` — ${o.stock_status}` : ''}`,
                }))}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={confirmVariantPick}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 rounded-lg disabled:opacity-50"
          >
            Confirm replacement with selected variant(s)
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-foreground-secondary">Type</span>
          <p className="font-medium text-foreground capitalize">{type}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Reason</span>
          <p className="font-medium text-foreground">{REASON_LABELS[reason] || reason}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Requested</span>
          <p className="font-medium text-foreground">{new Date(returnRequest.created_at).toLocaleDateString('en-IN')}</p>
        </div>
        <div>
          <span className="text-foreground-secondary">Status</span>
          <p className="font-medium text-foreground capitalize">{status.replace(/_/g, ' ')}</p>
        </div>
      </div>

      {returnRequest.items && returnRequest.items.length > 0 && (
        <div>
          <p className="text-sm text-foreground-secondary mb-2">
            Items being returned ·{' '}
            <span className="font-medium text-foreground">
              ₹{returnRequest.items.reduce((s, i) => s + parseFloat(String(i.refund_amount)), 0).toFixed(0)} refund
            </span>
          </p>
          <div className="divide-y divide-border-default border border-border-default rounded-lg overflow-hidden">
            {returnRequest.items.map(item => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-surface text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{item.product_name}</p>
                  {item.variant_name && <p className="text-xs text-foreground-secondary">{item.variant_name}</p>}
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-xs text-foreground-secondary">Qty {item.quantity} × ₹{parseFloat(String(item.unit_price)).toFixed(0)}</p>
                  <p className="font-medium text-foreground">₹{parseFloat(String(item.refund_amount)).toFixed(0)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {description && (        <div>
          <p className="text-sm text-foreground-secondary mb-1">Customer description</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">{description}</p>
        </div>
      )}

      {admin_notes && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Admin notes</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">{admin_notes}</p>
        </div>
      )}

      {return_tracking_number && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Return tracking number</p>
          <p className="text-sm font-mono text-foreground">{return_tracking_number}</p>
        </div>
      )}

      {returnRequest.replacement_order_id && replacementOrderNumber && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Replacement order</p>
          <Link
            href={ap(`/admin/orders/${returnRequest.replacement_order_id}`)}
            className="text-sm font-medium text-accent-500 hover:text-accent-600 underline"
          >
            #{replacementOrderNumber}
          </Link>
        </div>
      )}

      {status === 'pending_approval' && canWrite && (
        <div className="space-y-3 pt-2 border-t border-border-default">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Admin notes (required for rejection, optional for approval)
            </label>
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Notes visible to customer..."
              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => submit('approve')}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Approve Return'}
            </button>
            <button
              type="button"
              onClick={() => submit('reject')}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Reject Return'}
            </button>
          </div>
        </div>
      )}

      {status === 'approved' && (
        <div className="space-y-3 pt-2 border-t border-border-default">
          <div className="pb-1">
            {returnRequest.rvp_awb_number ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                  <span className="text-foreground-secondary">RVP AWB:</span>
                  <span className="font-mono font-medium text-foreground">{returnRequest.rvp_awb_number}</span>
                </div>
                {canWrite && (
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1">Reverse delivery charge (Rs)</label>
                    <div className="flex items-stretch gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rvpCharge}
                        onChange={e => setRvpCharge(e.target.value)}
                        placeholder="e.g. 80"
                        className="flex-1 px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleSaveRvpCharge}
                        disabled={rvpChargeSaving}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                      >
                        {rvpChargeSaving ? 'Saving...' : 'Save charge'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-foreground-muted">Charged to the tenant wallet for the reverse pickup. Re-saving updates the amount.</p>
                    {rvpChargeMsg && <p className="mt-1 text-xs text-foreground-secondary">{rvpChargeMsg}</p>}
                  </div>
                )}
              </div>
            ) : canWrite ? (
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={handleCreateRVP}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create RVP Pickup (Delhivery QC)'}
                </button>
                {warehouses.length > 0 && (
                  <div className="w-44 shrink-0" title="Warehouse the return is picked up to">
                    <AdminSelect
                      value={pickupLocation}
                      onChange={setPickupLocation}
                      options={warehouses}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {canWrite && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Return tracking number (optional)
                </label>
                <input
                  type="text"
                  value={returnTrackingNumber}
                  onChange={e => setReturnTrackingNumber(e.target.value)}
                  placeholder="e.g. 123456789012"
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => submit('mark_received')}
                disabled={isSubmitting}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Mark Item as Received'}
              </button>
            </>
          )}
        </div>
      )}

      {status === 'received' && (
        <div className="pt-2 border-t border-border-default space-y-4">
          {returnRequest.valuation_status !== 'approved' ? (
            <div className="flex items-start gap-3 px-3 py-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Valuation pending</p>
                <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                  Complete the item valuation in the <strong>Returns page</strong> before processing the {type === 'refund' ? 'refund' : 'replacement'}.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm">
                <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-green-800 dark:text-green-300">
                  Valuation complete — condition: <strong className="capitalize">{returnRequest.valuation_condition}</strong>
                  {returnRequest.valuation_condition !== 'good' && <span className="text-red-600 dark:text-red-400 ml-1">(no restock)</span>}
                </span>
              </div>
              <div>
                <p className="text-sm text-foreground-secondary mb-3">
                  {type === 'refund'
                    ? 'Issue a full refund via Razorpay.'
                    : 'Create a replacement order (confirmed, paid).'}
                </p>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => submit('process')}
                    disabled={isSubmitting}
                    className="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Processing...' : type === 'refund' ? 'Process Refund' : 'Create Replacement Order'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
