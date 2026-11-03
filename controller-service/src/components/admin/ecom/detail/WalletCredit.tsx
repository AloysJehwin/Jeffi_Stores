'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { ActionButton, Sheet, useActionToast } from '@/components/admin/kit'

const field = 'field-md w-full border border-border-default bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40'

/** Manual wallet credit (goodwill, a Delhivery reversal), audited server-side. */
export default function WalletCredit({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const toast = useActionToast()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setErr(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amountInr = Number(amount)
    if (!(amountInr > 0)) return setErr('Enter an amount above zero')
    if (!note.trim()) return setErr('Say why (it is recorded on the ledger)')
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/admin/ecom/${tenantId}/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountInr, note: note.trim() }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) return setErr(data?.error || data?.message || 'Credit failed')
    toast.success(`Credited ₹${amountInr.toLocaleString('en-IN')}`)
    setAmount('')
    setNote('')
    close()
    router.refresh()
  }

  return (
    <>
      <ActionButton action={{ label: 'Add credit', icon: Plus, onClick: () => setOpen(true) }} />
      <Sheet
        open={open}
        onClose={close}
        title="Credit the wallet"
        description="Goodwill or a Delhivery reversal. Posted as a platform credit with your note."
        footer={
          <>
            <button type="button" onClick={close} disabled={busy} className="control-md text-foreground-secondary hover:text-foreground">
              Cancel
            </button>
            <button type="submit" form={`credit-${tenantId}`} disabled={busy} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
              {busy ? 'Crediting…' : 'Credit'}
            </button>
          </>
        }
      >
        <form id={`credit-${tenantId}`} onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-foreground-muted">Amount (₹)</span>
            <input className={field} inputMode="decimal" autoFocus value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-foreground-muted">Reason</span>
            <input className={field} maxLength={300} placeholder="e.g. Delhivery reversed AWB 1234 weight dispute" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </form>
      </Sheet>
    </>
  )
}
