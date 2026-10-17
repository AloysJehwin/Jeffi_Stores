'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

// Product adjustments on a confirmed, unshipped order: switch lines to another product / variant / sub-variant /
// selling unit, change quantities or remove lines in one go. The customer approves; the net difference is
// refunded or collected when "Settle payment" is on, absorbed into the COD total, or waived when it's off.

export interface AdjustableItem {
  id: string
  productId: string
  productName: string
  quantity: number
  unit: string | null
  unitPrice: number
  totalPrice: number
  isDigital?: boolean
}

type Action = 'keep' | 'switch' | 'quantity' | 'remove'
interface Unit { unit: string; display_label: string | null; factor: number; is_base: boolean }
interface LineState {
  action: Action
  quantity: string
  target: { productId: string; variantId: string | null; subVariantId: string | null; label: string } | null
  unit: string
  units: Unit[]
}

const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const inputCls = 'w-full px-2.5 h-control-sm rounded-lg border border-border-secondary bg-surface text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
const STATUS: Record<string, string> = {
  pending_customer: 'Waiting for customer', awaiting_payment: 'Awaiting payment', applied: 'Applied', rejected: 'Declined', cancelled: 'Cancelled',
}

export default function ProductAdjustments({ orderId, items }: { orderId: string; items: AdjustableItem[] }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<Record<string, LineState>>({})
  const [settle, setSettle] = useState(true)
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [names, setNames] = useState<Record<string, string>>({})

  const loadHistory = useCallback(async () => {
    const r = await fetch(`/api/admin/orders/${orderId}/adjustments`, { credentials: 'include' })
    if (r.ok) setHistory((await r.json()).history || [])
  }, [orderId])
  useEffect(() => { loadHistory() }, [loadHistory])

  const pending = history.some(h => h.status === 'pending_customer' || h.status === 'awaiting_payment')
  const line = (id: string): LineState => lines[id] ?? { action: 'keep', quantity: '', target: null, unit: '', units: [] }
  const setLine = (id: string, patch: Partial<LineState>) => setLines(p => ({ ...p, [id]: { ...line(id), ...patch } }))

  type Payload = { orderItemId: string; action: 'switch' | 'quantity' | 'remove'; productId?: string; variantId?: string | null; subVariantId?: string | null; unit?: string | null; quantity?: number }
  const payload = useMemo(
    () =>
      items.flatMap((it): Payload[] => {
        const l = line(it.id)
        if (l.action === 'keep') return []
        if (l.action === 'remove') return [{ orderItemId: it.id, action: 'remove' as const }]
        const quantity = Number(l.quantity || it.quantity)
        if (l.action === 'quantity') return quantity === it.quantity ? [] : [{ orderItemId: it.id, action: 'quantity' as const, quantity }]
        if (!l.target) return []
        return [{ orderItemId: it.id, action: 'switch' as const, productId: l.target.productId, variantId: l.target.variantId, subVariantId: l.target.subVariantId, unit: l.unit || null, quantity }]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, items]
  )

  // Live preview from the server (same pricing as checkout).
  useEffect(() => {
    if (!open || !payload.length) { setPreview(null); setPreviewError(null); return }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/admin/orders/${orderId}/adjustments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ lines: payload, settlePayment: settle, dryRun: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setPreview(d.preview); setPreviewError(null) } else { setPreview(null); setPreviewError(d.error || 'Could not price this change') }
    }, 400)
    return () => clearTimeout(t)
  }, [open, payload, settle, orderId])

  async function pickTarget(itemId: string, s: { id: string; label: string }) {
    const p = s.id.split('|')
    const target = { productId: p[0], variantId: p[1] || null, subVariantId: p[7] || null, label: s.label }
    const q = new URLSearchParams({ chain: '1', ...(target.variantId ? { variant_id: target.variantId } : {}), ...(target.subVariantId ? { sub_variant_id: target.subVariantId } : {}) })
    const r = await fetch(`/api/admin/products/${target.productId}/units?${q}`, { credentials: 'include' })
    const units: Unit[] = r.ok ? ((await r.json()).units || []).map((u: any) => ({ ...u, factor: Number(u.factor) || 1 })) : []
    setLine(itemId, { target, units, unit: units[0]?.unit ?? '' })
    setNames(n => ({ ...n, [itemId]: s.label }))
  }

  async function submit() {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/adjustments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ lines: payload, settlePayment: settle, adminNotes: notes || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(d.error || 'Could not send the change', 'error'); return }
      showToast('Sent to the customer for approval', 'success')
      setLines({}); setNotes(''); setPreview(null); setOpen(false)
      await loadHistory()
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id: string) {
    const r = await fetch(`/api/admin/orders/${orderId}/adjustments/${id}/cancel`, { method: 'POST', credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) showToast(d.error || 'Could not cancel', 'error')
    else { showToast('Change cancelled', 'success'); loadHistory() }
  }

  const net = preview?.netDiff ?? 0
  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Product adjustments</h3>
          <p className="text-xs text-foreground-muted">Switch, re-quantify or remove items before shipping. The customer approves first.</p>
        </div>
        <RequireWrite scope="orders:write">
          {!open && !pending && (
            <button type="button" onClick={() => setOpen(true)} className="h-control-sm px-3 rounded-lg text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white">
              Adjust items
            </button>
          )}
        </RequireWrite>
      </div>

      {open && (
        <div className="space-y-3">
          {items.map(it => {
            const l = line(it.id)
            const pv = preview?.lines?.find((x: any) => x.orderItemId === it.id)
            return (
              <div key={it.id} className={`rounded-lg border p-3 space-y-2 ${l.action === 'remove' ? 'border-red-300 bg-red-50/50 dark:bg-red-900/10' : 'border-border-default'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${l.action === 'remove' ? 'line-through text-foreground-muted' : 'text-foreground'}`}>{it.productName}</p>
                    <p className="text-xs text-foreground-muted">{it.quantity}{it.unit ? ` ${it.unit}` : ''} × {inr(it.unitPrice)} = {inr(it.totalPrice)}</p>
                  </div>
                  <div className="flex gap-1">
                    {(['keep', 'switch', 'quantity', 'remove'] as Action[])
                      .filter(a => !it.isDigital || a === 'keep' || a === 'remove')
                      .map(a => (
                        <button key={a} type="button" onClick={() => setLine(it.id, { action: a, quantity: l.quantity || String(it.quantity) })}
                          className={`h-control-sm px-2.5 rounded-md text-xs font-semibold border ${l.action === a ? 'bg-accent-500 border-accent-500 text-white' : 'border-border-default text-foreground hover:bg-surface-secondary'}`}>
                          {a === 'keep' ? 'Keep' : a === 'switch' ? 'Switch' : a === 'quantity' ? 'Change qty' : 'Remove'}
                        </button>
                      ))}
                  </div>
                </div>

                {l.action === 'switch' && (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_100px] gap-2">
                    <AdminTypeahead type="line_items" value={names[it.id] ?? ''} onChange={v => setNames(n => ({ ...n, [it.id]: v }))}
                      onSelect={s => pickTarget(it.id, s)} inputClassName={inputCls} placeholder="Search the product, variant or sub-variant…" />
                    {l.units.length > 1 ? (
                      <AdminSelect sm value={l.unit} onChange={v => setLine(it.id, { unit: v })}
                        options={l.units.map(u => ({ value: u.unit, label: `${u.display_label || u.unit}${u.factor !== 1 ? ` (${u.factor} pcs)` : ''}${u.is_base ? ' · default' : ''}` }))} />
                    ) : (
                      <div className="h-control-sm px-2.5 flex items-center text-xs text-foreground-muted border border-border-default rounded-lg">{l.units[0]?.display_label || l.units[0]?.unit || 'Unit'}</div>
                    )}
                    <input type="number" min="1" step="any" value={l.quantity} onChange={e => setLine(it.id, { quantity: e.target.value })} className={inputCls} aria-label="Quantity" />
                  </div>
                )}
                {l.action === 'quantity' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">New quantity</span>
                    <input type="number" min="1" step="any" value={l.quantity} onChange={e => setLine(it.id, { quantity: e.target.value })} className={`${inputCls} max-w-[120px]`} />
                  </div>
                )}
                {pv && (
                  <p className="text-xs text-foreground-secondary">
                    {pv.new ? `${pv.new.productName} · ${pv.new.quantity}${pv.new.unit ? ` ${pv.new.unit}` : ''} × ${inr(pv.new.unitPrice)} = ${inr(pv.new.total)} · ` : 'Removed · '}
                    <span className={pv.diff < 0 ? 'text-green-600' : pv.diff > 0 ? 'text-amber-600' : ''}>{pv.diff === 0 ? 'no change' : `${pv.diff < 0 ? '−' : '+'}${inr(pv.diff)}`}</span>
                  </p>
                )}
              </div>
            )
          })}

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={settle} onChange={e => setSettle(e.target.checked)} className="h-4 w-4 accent-accent-500" />
            Settle payment — refund or collect the difference
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Note for the record (optional)" className={`${inputCls} h-auto py-2 resize-none`} />

          {previewError && <p className="text-xs text-red-600">{previewError}</p>}
          {preview && (
            <div className="rounded-lg bg-surface-secondary p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-foreground-muted">Items</span><span>{inr(preview.oldSubtotal)} → {inr(preview.newSubtotal)}</span></div>
              {(preview.oldDiscount > 0 || preview.newDiscount > 0) && (
                <div className="flex justify-between"><span className="text-foreground-muted">Discount</span><span>{inr(preview.oldDiscount)} → {inr(preview.newDiscount)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-foreground-muted">Order total</span><span>{inr(preview.oldTotal)} → {inr(preview.newTotal)}</span></div>
              <div className="flex justify-between font-semibold pt-1 border-t border-border-default">
                <span>
                  {preview.settlementType === 'refund' ? 'Refund to customer' : preview.settlementType === 'collect' ? 'Customer pays extra'
                    : preview.settlementType === 'cod_adjust' ? 'Collected on delivery' : net !== 0 ? 'Difference waived' : 'No difference'}
                </span>
                <span>{net !== 0 ? inr(net) : '—'}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); setLines({}); setPreview(null) }} className="h-control px-4 rounded-lg text-sm font-semibold border border-border-default text-foreground hover:bg-surface-secondary">Cancel</button>
            <button type="button" onClick={submit} disabled={busy || !preview} className="h-control px-4 rounded-lg text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Send to customer'}
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2 pt-1">
          {history.map(h => (
            <div key={h.id} className="rounded-lg border border-border-default px-3 py-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {STATUS[h.status] ?? h.status}{h.legacy ? ' · variant change' : ''}
                  {h.refund_status === 'pending' && <span className="ml-1.5 text-amber-600">· refund pending — use “Refund for approved changes”</span>}
                  {h.refund_status === 'refunded' && <span className="ml-1.5 text-green-600">· refunded</span>}
                </span>
                <span className="text-foreground-muted">
                  {Number(h.net_diff) === 0 ? 'no difference' : `${Number(h.net_diff) < 0 ? 'refund' : 'extra'} ${inr(Number(h.net_diff))}`} · {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              {(h.lines || []).map((l: any, i: number) => (
                <p key={i} className="text-foreground-secondary">
                  {l.action === 'remove' ? `Removed ${l.old?.name}` : `${l.old?.name} → ${l.new?.productName ?? ''}${l.new?.quantity ? ` × ${l.new.quantity}` : ''}`}
                </p>
              ))}
              {!h.legacy && (h.status === 'pending_customer' || h.status === 'awaiting_payment') && (
                <RequireWrite scope="orders:write">
                  <button type="button" onClick={() => cancel(h.id)} className="text-red-600 hover:underline">Cancel request</button>
                </RequireWrite>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
