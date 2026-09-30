'use client'

import { useState, useEffect } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import CopySku from '@/components/ui/CopySku'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface OrderItemLite {
  id: string
  productId: string
  productName: string
  variantName: string | null
  unitPrice: number
  quantity: number
}

interface Candidate {
  id: string
  name: string | null
  sku: string | null
  effectivePrice: number
  stock_status: string | null
  length_cm: number | null
  breadth_cm: number | null
  height_cm: number | null
  weight_grams: number | null
  parent_variant_name?: string | null
}

function dims(c: Candidate): string {
  const d = [c.length_cm, c.breadth_cm, c.height_cm].filter(v => v != null)
  const parts: string[] = []
  if (d.length === 3) parts.push(`${c.length_cm}×${c.breadth_cm}×${c.height_cm} cm`)
  if (c.weight_grams != null) parts.push(`${c.weight_grams} g`)
  return parts.join(' · ')
}

interface HistoryRow {
  id: string
  status: string
  settlement_type: string
  price_diff: number
  product_name: string
  old_variant_name: string | null
  new_variant_name: string | null
  created_at: string
  applied_at: string | null
}

const STATUS_STYLE: Record<string, string> = {
  pending_customer: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  awaiting_payment: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  applied: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}
const STATUS_LABEL: Record<string, string> = {
  pending_customer: 'Awaiting customer',
  awaiting_payment: 'Awaiting payment',
  applied: 'Applied',
  rejected: 'Declined',
  cancelled: 'Cancelled',
}

export default function VariantChangeRequest({ orderId, items }: { orderId: string; items: OrderItemLite[] }) {
  const [open, setOpen] = useState(false)
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? '')
  const [variants, setVariants] = useState<Candidate[]>([])
  const [subVariants, setSubVariants] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<{
    kind: 'variant' | 'sub'
    id: string
    price: number
    name: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [settlePayment, setSettlePayment] = useState(true)

  const selectedItem = items.find(i => i.id === itemId)

  async function loadHistory() {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/variant-change?history=1`)
      const data = await res.json()
      if (res.ok) setHistory(data.history || [])
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadHistory() /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [orderId])

  async function cancelRequest(vcrId: string) {
    setCancellingId(vcrId)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/variant-change/${vcrId}/cancel`, { method: 'POST' })
      if (res.ok) await loadHistory()
    } catch {
      /* ignore */
    } finally {
      setCancellingId(null)
    }
  }

  const hasPending = history.some(h => h.status === 'pending_customer' || h.status === 'awaiting_payment')

  async function loadCandidates(pid: string) {
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/variant-change?productId=${pid}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load variants')
      setVariants(data.variants || [])
      setSubVariants(data.subVariants || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function openPanel() {
    setOpen(true)
    setSettlePayment(true)
    if (selectedItem) loadCandidates(selectedItem.productId)
  }

  const priceDiff =
    selected && selectedItem
      ? Math.round((selected.price - selectedItem.unitPrice) * selectedItem.quantity * 100) / 100
      : 0

  async function submit() {
    if (!selectedItem || !selected) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/variant-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId: selectedItem.id,
          newVariantId: selected.kind === 'variant' ? selected.id : null,
          newSubVariantId: selected.kind === 'sub' ? selected.id : null,
          settlePayment,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to request change')
      setDone('Change requested — the customer has been notified to confirm.')
      setOpen(false)
      await loadHistory()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Request Variant Change</h2>
        {!open && !done && !hasPending && (
          <RequireWrite scope="orders:write">
            <button onClick={openPanel} className="text-sm font-semibold text-accent-500 hover:text-accent-400">
              Start
            </button>
          </RequireWrite>
        )}
      </div>
      <div className="p-4 sm:p-6 space-y-4">
        {/* History — every request raised on this order, with status. */}
        {history.length > 0 && (
          <div className="space-y-2">
            {history.map(h => {
              const diff = Number(h.price_diff)
              return (
                <div
                  key={h.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border-default bg-surface-secondary"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="line-through text-foreground-muted">{h.old_variant_name || h.product_name}</span>
                      {' → '}
                      <strong>{h.new_variant_name || '—'}</strong>
                    </p>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      {h.settlement_type === 'refund'
                        ? `Refund ₹${Math.abs(diff).toFixed(2)}`
                        : h.settlement_type === 'collect'
                          ? `Collect ₹${Math.abs(diff).toFixed(2)}`
                          : h.settlement_type === 'cod_adjust'
                            ? `COD ±₹${Math.abs(diff).toFixed(2)}`
                            : 'No price change'}
                      {' · '}
                      {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[h.status] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {STATUS_LABEL[h.status] || h.status}
                    </span>
                    {(h.status === 'pending_customer' || h.status === 'awaiting_payment') && (
                      <RequireWrite scope="orders:write">
                        <button
                          onClick={() => cancelRequest(h.id)}
                          disabled={cancellingId === h.id}
                          className="text-[11px] text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {cancellingId === h.id ? 'Cancelling…' : 'Cancel request'}
                        </button>
                      </RequireWrite>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {done ? (
          <p className="text-sm text-green-600 dark:text-green-400">{done}</p>
        ) : hasPending && !open ? (
          <p className="text-sm text-foreground-muted">
            A variant change is pending customer action. Cancel it above to raise a new one.
          </p>
        ) : !open ? (
          <p className="text-sm text-foreground-muted">
            Swap an ordered item for a near-dimension variant of the same product. The customer confirms; any price
            difference is refunded, collected, or adjusted (COD) automatically, unless you choose to swap at the current
            price.
          </p>
        ) : (
          <>
            <div>
              <AdminSelect
                label="Order item"
                value={itemId}
                onChange={v => {
                  setItemId(v)
                  const it = items.find(i => i.id === v)
                  if (it) loadCandidates(it.productId)
                }}
                options={items.map(it => ({
                  value: it.id,
                  label: `${it.productName}${it.variantName ? ` — ${it.variantName}` : ''} (₹${it.unitPrice.toFixed(2)} × ${it.quantity})`,
                }))}
              />
            </div>

            {loading ? (
              <p className="text-sm text-foreground-muted">Loading variants…</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                <label className="block text-sm font-medium text-foreground mb-1">Replacement</label>
                {[
                  ...variants.map(v => ({ ...v, kind: 'variant' as const })),
                  ...subVariants.map(s => ({ ...s, kind: 'sub' as const })),
                ]
                  .filter(c => !(c.kind === 'variant' && c.id === selectedItem?.id))
                  .map(c => {
                    const isSel = selected?.kind === c.kind && selected?.id === c.id
                    return (
                      <button
                        key={`${c.kind}-${c.id}`}
                        onClick={() => setSelected({ kind: c.kind, id: c.id, price: c.effectivePrice, name: c.name })}
                        className={`w-full text-left p-2.5 rounded-lg border text-sm ${isSel ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default hover:border-border-secondary'}`}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-foreground">
                            {c.kind === 'sub' && c.parent_variant_name ? `${c.parent_variant_name} / ` : ''}
                            {c.name || c.sku}
                            {!c.name && c.sku && <CopySku sku={c.sku} />}
                          </span>
                          <span className="text-foreground">₹{Number(c.effectivePrice).toFixed(2)}</span>
                        </div>
                        <div className="text-xs text-foreground-muted mt-0.5 flex justify-between gap-2">
                          <span>{dims(c) || '—'}</span>
                          <span className={c.stock_status === 'Out of Stock' ? 'text-red-500' : 'text-green-600'}>
                            {c.stock_status}
                          </span>
                        </div>
                      </button>
                    )
                  })}
              </div>
            )}

            {selected && selectedItem && (
              <div className="bg-surface-secondary rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-muted">Current line</span>
                  <span>₹{(selectedItem.unitPrice * selectedItem.quantity).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-muted">New line</span>
                  <span>₹{(selected.price * selectedItem.quantity).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold mt-1 pt-1 border-t border-border-default">
                  <span>
                    {priceDiff === 0
                      ? 'No price change'
                      : !settlePayment
                        ? 'Difference waived'
                        : priceDiff < 0
                          ? 'Refund to customer'
                          : 'Extra payable by customer'}
                  </span>
                  <span
                    className={
                      !settlePayment && priceDiff !== 0
                        ? 'text-foreground-muted line-through'
                        : priceDiff < 0
                          ? 'text-green-600'
                          : priceDiff > 0
                            ? 'text-orange-600'
                            : ''
                    }
                  >
                    ₹{Math.abs(priceDiff).toFixed(2)}
                  </span>
                </div>

                {priceDiff !== 0 && (
                  <div className="mt-3 pt-3 border-t border-border-default">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">Settle the price difference</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settlePayment}
                        aria-label="Settle the price difference"
                        onClick={() => setSettlePayment(v => !v)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${settlePayment ? 'bg-accent-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settlePayment ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-foreground-muted mt-1.5">
                      {settlePayment
                        ? priceDiff < 0
                          ? `₹${Math.abs(priceDiff).toFixed(2)} is refunded to the customer once they confirm.`
                          : `The customer is asked to pay ₹${Math.abs(priceDiff).toFixed(2)} more when they confirm (added to the amount due for COD).`
                        : priceDiff < 0
                          ? `No refund is made. The variant is swapped once the customer confirms, and they keep paying the current price, which is ₹${Math.abs(priceDiff).toFixed(2)} more than this variant's price.`
                          : `No payment is requested. The variant is swapped once the customer confirms, and you absorb the ₹${Math.abs(priceDiff).toFixed(2)} difference.`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={!selected || submitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-accent-600 hover:bg-accent-700 rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Requesting…' : 'Request change & notify customer'}
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  setSelected(null)
                  setError(null)
                }}
                className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
