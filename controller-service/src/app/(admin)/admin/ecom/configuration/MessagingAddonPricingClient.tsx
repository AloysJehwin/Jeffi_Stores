'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'

type Line = { label: string; inrMonth: number }
type View = { costLines: Line[]; marginPct: number; costInr: number; priceInr: number; defaults: { costLines: Line[]; marginPct: number } }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** Configuration → SMS & WhatsApp add-on: what one store's own senders cost the platform each month, and the margin on top. */
export default function MessagingAddonPricingClient() {
  const canWrite = useCanWrite('ecom_billing:write')
  const toast = useActionToast()
  const [view, setView] = useState<View | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [margin, setMargin] = useState(40)
  const [saving, setSaving] = useState(false)

  const load = (v: View) => {
    setView(v)
    setLines(v.costLines.map(l => ({ ...l })))
    setMargin(v.marginPct)
  }
  useEffect(() => {
    api<View>('/api/admin/ecom/messaging-addon-pricing').then(({ ok, data }) => ok && load(data))
  }, [])

  if (!view) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />

  const cost = Math.round(lines.reduce((a, l) => a + (Number(l.inrMonth) || 0), 0) * 100) / 100
  const price = Math.max(1, Math.ceil(cost * (1 + (Number(margin) || 0) / 100)))
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function save() {
    setSaving(true)
    const { ok, data } = await api<View>('/api/admin/ecom/messaging-addon-pricing', {
      method: 'PUT',
      json: { costLines: lines.map(l => ({ label: l.label.trim(), inrMonth: Number(l.inrMonth) || 0 })), marginPct: Number(margin) || 0 },
    })
    setSaving(false)
    if (!ok) return toast.error(data.error || 'Could not save the add-on pricing.')
    load(data)
    toast.success(`Saved. Stores now pay ${inr(data.priceInr)}/month; current months renew at the new fee.`)
  }

  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5 space-y-4 min-w-0">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">SMS & WhatsApp add-on</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          One monthly service fee for a store&apos;s own SMS and WhatsApp numbers. List what each store&apos;s numbers cost the platform per month;
          the fee is that total plus the margin, rounded up to the rupee. Messages themselves are billed from the store&apos;s wallet as before.
        </p>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input aria-label="Cost" value={l.label} disabled={!canWrite} onChange={e => set(i, { label: e.target.value })} className={`${inputCls} min-w-0 flex-1 basis-56`} />
            <div className="flex items-center gap-1">
              <span className="text-sm text-foreground-muted">₹</span>
              <input
                aria-label="Monthly amount (₹)"
                type="number"
                min={0}
                step="0.01"
                value={l.inrMonth}
                disabled={!canWrite}
                onChange={e => set(i, { inrMonth: Number(e.target.value) })}
                className={`${inputCls} w-28`}
              />
              <span className="text-xs text-foreground-muted">/month</span>
            </div>
            {canWrite && lines.length > 1 && (
              <button type="button" title="Remove" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="control-sm border border-border-default">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {canWrite && (
          <button type="button" onClick={() => setLines(ls => [...ls, { label: '', inrMonth: 0 }])} className={`${btnGhost} inline-flex items-center gap-1.5`}>
            <Plus className="h-4 w-4" /> Add cost
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-foreground-secondary">Margin</span>
        <input type="number" min={0} max={500} value={margin} disabled={!canWrite} onChange={e => setMargin(Number(e.target.value))} className={`${inputCls} w-20`} />
        <span className="text-foreground-muted">%</span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-default pt-3">
        <p className="text-sm text-foreground">
          Cost {inr(cost)} + {Number(margin) || 0}% = <span className="font-semibold">{inr(price)}/month</span> per store
          {price !== view.priceInr && <span className="text-foreground-muted"> (now {inr(view.priceInr)})</span>}
        </p>
        {canWrite && (
          <button type="button" onClick={save} disabled={saving || lines.some(l => !l.label.trim())} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}
