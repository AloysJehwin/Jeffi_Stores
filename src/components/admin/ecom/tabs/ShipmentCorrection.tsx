'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ShipmentCorrection({
  tenantId,
  orderId,
  awb,
  currentBilled,
  alreadyBilled,
}: {
  tenantId: string
  orderId: string
  awb: string
  currentBilled: number | null
  alreadyBilled: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(currentBilled != null ? String(currentBilled) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const value = Number(amount)
    if (!(value >= 0)) {
      setErr('Enter a valid amount')
      return
    }
    if (!note.trim()) {
      setErr('A proof note is required')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/shipments/${orderId}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargedAmount: value, proofNote: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || 'Correction failed')
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setErr('Correction failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!awb}
        className="text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50"
      >
        {alreadyBilled ? 'Correct charge' : 'Set charge'}
      </button>
    )
  }

  return (
    <div className="text-left space-y-2 rounded-lg border border-border-default bg-surface p-3 w-64">
      <div className="text-xs text-foreground-muted">AWB {awb}</div>
      <input
        className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground"
        inputMode="decimal"
        placeholder="Actual billed ₹"
        value={amount}
        onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
      />
      <input
        className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground"
        placeholder="Proof / reference"
        value={note}
        onChange={e => setNote(e.target.value)}
      />
      {err && <div className="text-[11px] text-red-600 dark:text-red-400">{err}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setErr(null)
          }}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
