'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { fmtQty } from '@/lib/shared/number-display'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { NumberInput, TextArea, TextInput } from '@/components/admin/kit/form'
import { Field, Fields } from '@/components/admin/kit/layout'

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
  const toast = useActionToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Inline only for validation and the variant-pick prompt; responses are toasts.
  const [error, setError] = useState<string | null>(null)
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
  const [rvpChargeError, setRvpChargeError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSaveRvpCharge() {
    const amount = Number(rvpCharge)
    if (!(amount >= 0) || !Number.isFinite(amount)) {
      setRvpChargeError('Enter a valid amount.')
      return
    }
    setRvpChargeSaving(true)
    setRvpChargeError(null)
    try {
      const res = await fetch(`/api/admin/returns/${returnRequest.id}/rvp-charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charge: amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save charge')
      if (data.walletWarning) toast.warning(`Saved. ${data.walletWarning}`)
      else toast.success('Charge saved.')
      router.refresh()
    } catch (e: any) {
      toast.error(e.message)
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
        if (opts.length > 0) setPickupLocation(prev => prev || opts[0].value)
      })
      .catch(() => {})
  }, [])

  async function handleCreateRVP() {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/create-rvp-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickupLocation ? { pickupLocation } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`RVP shipment created. AWB: ${data.awb}`)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submit(
    action: string,
    replacementVariants?: Record<string, { variant_id: string | null; sub_variant_id: string | null }>
  ) {
    if (action === 'reject' && !adminNotes.trim()) {
      setError('Please provide a reason for rejection.')
      return
    }

    setIsSubmitting(true)
    setError(null)

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
        toast.warning(
          `Stock was NOT restored for ${data.stockWarnings.length} item(s) — the variant/sub-variant no longer exists or is inactive. The return was still processed.`
        )
      }

      if (action === 'process' && data.refundFailed) {
        toast.warning(
          'Return marked as resolved. Note: Razorpay refund could not be initiated automatically — please issue it manually.'
        )
      } else if (action === 'approve') {
        toast.success('Return request approved. Customer notified.')
      } else if (action === 'reject') {
        toast.success('Return request rejected. Customer notified.')
      } else if (action === 'mark_received') {
        toast.success('Item marked as received. Customer notified.')
      } else if (action === 'process') {
        if (data.replacementOrderNumber) {
          toast.success(`Replacement order #${data.replacementOrderNumber} created. Customer notified.`)
        } else if (typeof data.netRefund === 'number' && data.netRefund <= 0 && Number(data.charge) > 0) {
          toast.success(
            `No refund issued — the ₹${Number(data.charge).toFixed(0)} return charge covers the ₹${Number(data.grossRefund).toFixed(0)} returnable amount. The item was accepted and restocked.`
          )
        } else if (typeof data.netRefund === 'number' && Number(data.charge) > 0) {
          toast.success(
            `Refund of ₹${Number(data.netRefund).toFixed(0)} processed (₹${Number(data.grossRefund).toFixed(0)} less ₹${Number(data.charge).toFixed(0)} return charge). Customer notified.`
          )
        } else {
          toast.success('Refund processed. Customer notified.')
        }
      }

      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
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
      if (!sel) {
        setError('Please choose a replacement variant for every item.')
        return
      }
      // Encoded value: "variantId|subVariantId" (subVariantId may be empty).
      const [vid, svid] = sel.split('|')
      map[it.order_item_id] = { variant_id: vid || null, sub_variant_id: svid || null }
    }
    submit('process', map)
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {variantPick && variantPick.length > 0 && canWrite && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Choose replacement variant(s)</p>
          {variantPick.map((it: any) => (
            <div key={it.order_item_id} className="space-y-1">
              <p className="text-xs text-foreground-muted">
                {it.product_name}
                {it.variant_name ? ` — original: ${it.variant_name}` : ''} (no longer available)
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
            className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            Confirm replacement with selected variant(s)
          </button>
        </div>
      )}

      <Fields>
        <Field label="Type" value={<span className="font-medium capitalize">{type}</span>} />
        <Field label="Reason" value={<span className="font-medium">{REASON_LABELS[reason] || reason}</span>} />
        <Field label="Requested" value={<span className="font-medium">{new Date(returnRequest.created_at).toLocaleDateString('en-IN')}</span>} />
        <Field label="Status" value={<span className="font-medium capitalize">{status.replace(/_/g, ' ')}</span>} />
      </Fields>

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
                  <p className="text-xs text-foreground-secondary">
                    Qty {fmtQty(item.quantity)} × ₹{parseFloat(String(item.unit_price)).toFixed(0)}
                  </p>
                  <p className="font-medium text-foreground">₹{parseFloat(String(item.refund_amount)).toFixed(0)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {description && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Customer description</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">
            {description}
          </p>
        </div>
      )}

      {admin_notes && (
        <div>
          <p className="text-sm text-foreground-secondary mb-1">Admin notes</p>
          <p className="text-sm text-foreground bg-surface rounded-lg border border-border-default px-3 py-2">
            {admin_notes}
          </p>
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
            href={ap(`/admin/orders/${returnRequest.replacement_order_id}/view`)}
            className="text-sm font-medium text-accent-500 hover:text-accent-600 underline"
          >
            #{replacementOrderNumber}
          </Link>
        </div>
      )}

      {status === 'pending_approval' && canWrite && (
        <div className="space-y-3 pt-2 border-t border-border-default">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
              Admin notes (required for rejection, optional for approval)
            </label>
            <TextArea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} placeholder="Notes visible to customer..." className="resize-none" />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => submit('approve')}
              disabled={isSubmitting}
              className="control-md flex-1 justify-center bg-green-600 hover:bg-green-700 font-semibold text-white disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : 'Approve Return'}
            </button>
            <button
              type="button"
              onClick={() => submit('reject')}
              disabled={isSubmitting}
              className="control-md flex-1 justify-center bg-red-600 hover:bg-red-700 font-semibold text-white disabled:opacity-50"
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
                <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm">
                  <span className="text-foreground-secondary">RVP AWB:</span>
                  <span className="font-mono font-medium text-foreground">{returnRequest.rvp_awb_number}</span>
                </div>
                {canWrite && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                      Reverse delivery charge (Rs)
                    </label>
                    <div className="flex items-stretch gap-2">
                      <NumberInput min="0" step="0.01" value={rvpCharge} onChange={e => setRvpCharge(e.target.value)} placeholder="e.g. 80" className="flex-1" />
                      <button
                        type="button"
                        onClick={handleSaveRvpCharge}
                        disabled={rvpChargeSaving}
                        className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
                      >
                        {rvpChargeSaving ? 'Saving...' : 'Save charge'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-foreground-muted">
                      Charged to the tenant wallet for the reverse pickup. Re-saving updates the amount.
                    </p>
                    {rvpChargeError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{rvpChargeError}</p>}
                  </div>
                )}
              </div>
            ) : canWrite ? (
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={handleCreateRVP}
                  disabled={isSubmitting}
                  className="control-md flex-1 justify-center bg-accent-500 hover:bg-accent-600 font-semibold text-white disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create RVP Pickup (Delhivery QC)'}
                </button>
                {warehouses.length > 0 && (
                  <div className="w-44 shrink-0" title="Warehouse the return is picked up to">
                    <AdminSelect value={pickupLocation} onChange={setPickupLocation} options={warehouses} />
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {canWrite && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                  Return tracking number (optional)
                </label>
                <TextInput value={returnTrackingNumber} onChange={e => setReturnTrackingNumber(e.target.value)} placeholder="e.g. 123456789012" />
              </div>
              <button
                type="button"
                onClick={() => submit('mark_received')}
                disabled={isSubmitting}
                className="control-md w-full justify-center bg-accent-500 hover:bg-accent-600 font-semibold text-white disabled:opacity-50"
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
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-foreground">Valuation pending</p>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  Complete the item valuation in the <strong>Returns page</strong> before processing the{' '}
                  {type === 'refund' ? 'refund' : 'replacement'}.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                <span className="text-foreground">
                  Valuation complete — condition:{' '}
                  <strong className="capitalize">{returnRequest.valuation_condition}</strong>
                  {returnRequest.valuation_condition !== 'good' && (
                    <span className="text-red-600 dark:text-red-400 ml-1">(no restock)</span>
                  )}
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
                    className="control-md w-full justify-center bg-accent-500 hover:bg-accent-600 font-semibold text-white disabled:opacity-50"
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
