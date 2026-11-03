'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, useActionToast } from '@/components/admin/kit'
import type { ShipmentRow } from '@controller/lib/orders/tenant-shipments-shared'

const field = 'field-md w-full border border-border-default bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40'

/** Sets (first time) or corrects a shipment's real Delhivery charge; the wallet is netted to it. */
export default function ShipmentCorrection({ tenantId, shipment, onClose }: { tenantId: string; shipment: ShipmentRow | null; onClose: () => void }) {
  return shipment ? <Form key={shipment.id} tenantId={tenantId} s={shipment} onClose={onClose} /> : null
}

function Form({ tenantId, s, onClose }: { tenantId: string; s: ShipmentRow; onClose: () => void }) {
  const router = useRouter()
  const toast = useActionToast()
  const [amount, setAmount] = useState(s.delhivery_billed_amount != null ? String(Number(s.delhivery_billed_amount)) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const billed = s.delhivery_billed_at != null

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const value = Number(amount)
    if (amount.trim() === '' || !(value >= 0)) return setErr('Enter a valid amount')
    if (!note.trim()) return setErr('A proof note is required')
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/admin/ecom/${tenantId}/shipments/${s.id}/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chargedAmount: value, proofNote: note.trim() }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) return setErr(data?.error || 'Correction failed')
    toast.success(billed ? 'Charge corrected' : 'Charge set')
    onClose()
    router.refresh()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={billed ? 'Correct charge' : 'Set charge'}
      description={`Order ${s.order_number || '—'} · AWB ${s.awb_number || '—'}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="control-md text-foreground-secondary hover:text-foreground">
            Cancel
          </button>
          <button type="submit" form={`ship-${s.id}`} disabled={busy} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </>
      }
    >
      <form id={`ship-${s.id}`} onSubmit={submit} className="space-y-3">
        <p className="text-xs text-foreground-muted">
          {billed
            ? 'Delhivery re-priced this shipment after weight capture. The wallet is netted to the new figure.'
            : 'The wallet holds an estimate; this settles it to what Delhivery billed.'}
        </p>
        <label className="block space-y-1">
          <span className="text-xs text-foreground-muted">Actual billed (₹)</span>
          <input className={field} inputMode="decimal" autoFocus value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-foreground-muted">Proof / reference</span>
          <input className={field} placeholder="Invoice number, ticket or note" value={note} onChange={e => setNote(e.target.value)} />
        </label>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </form>
    </Sheet>
  )
}
