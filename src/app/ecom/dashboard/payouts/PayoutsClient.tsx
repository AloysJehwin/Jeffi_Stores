'use client'

import { useState } from 'react'

export interface BankState {
  last4: string | null
  ifsc: string | null
  holderName: string | null
  verifiedName: string | null
  verificationStatus: string | null
  verificationRef: string | null
  hasRouteAccount: boolean
}

const STATE: Record<string, { label: string; tone: string; blurb: string }> = {
  verified: {
    label: 'Verified',
    tone: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30',
    blurb: 'Your payouts settle to this account.',
  },
  unverified: {
    label: 'Awaiting verification',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    blurb: 'Saved, but not yet confirmed by the payment provider. Payouts start once it is.',
  },
  failed: {
    label: 'Rejected',
    tone: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
    blurb: 'The payment provider would not accept this account. Payouts are on hold until it is corrected.',
  },
}

export default function PayoutsClient({ initial }: { initial: BankState | null }) {
  const [bank, setBank] = useState<BankState | null>(initial)
  const [editing, setEditing] = useState(!initial)
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmNumber, setConfirmNumber] = useState('')
  const [ifsc, setIfsc] = useState(initial?.ifsc ?? '')
  const [holderName, setHolderName] = useState(initial?.holderName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const status = bank?.verificationStatus ?? 'unverified'
  const meta = STATE[status] ?? STATE.unverified
  const mismatch = confirmNumber.length > 0 && accountNumber !== confirmNumber
  const canSubmit = accountNumber.length >= 9 && !mismatch && ifsc.length === 11 && holderName.trim().length > 0

  async function submit() {
    setBusy(true); setError(null); setDone(null)
    try {
      const res = await fetch('/api/ecom/bank/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber, ifsc: ifsc.toUpperCase(), holderName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.reason || data.error || 'Could not save those details.')
      } else {
        setBank({
          last4: accountNumber.slice(-4),
          ifsc: ifsc.toUpperCase(),
          holderName,
          verifiedName: data.verifiedName ?? null,
          verificationStatus: data.status ?? 'unverified',
          verificationRef: null,
          hasRouteAccount: !!data.pushedToRoute,
        })
        setDone(data.pushedToRoute
          ? 'Updated with the payment provider.'
          : 'Saved. It will be sent to the payment provider when your store goes live.')
        setEditing(false)
        setAccountNumber(''); setConfirmNumber('')
      }
    } catch {
      setError('Network error — please try again.')
    }
    setBusy(false)
  }

  const inp = 'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground'
  const lbl = 'block text-xs font-medium text-foreground-muted mb-1'

  return (
    <div className="max-w-xl space-y-6">
      {bank && !editing && (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Settlement account</p>
              <p className="text-sm text-foreground-muted mt-1 font-mono">
                ••••{bank.last4} · {bank.ifsc}
              </p>
              <p className="text-sm text-foreground-muted">{bank.verifiedName || bank.holderName}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>
              {meta.label}
            </span>
          </div>
          <p className="text-xs text-foreground-muted mt-3">{meta.blurb}</p>
          {done && <p className="text-xs text-green-700 dark:text-green-300 mt-2">{done}</p>}
          <button
            onClick={() => { setEditing(true); setDone(null) }}
            className="mt-4 rounded-lg border border-border-default px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
          >
            {status === 'failed' ? 'Correct these details' : 'Change account'}
          </button>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-5 space-y-4">
          <p className="text-sm font-semibold text-foreground">
            {bank ? 'Update settlement account' : 'Add a settlement account'}
          </p>
          <div>
            <label className={lbl}>Account number</label>
            <input className={inp} value={accountNumber} inputMode="numeric" autoComplete="off"
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))} />
          </div>
          <div>
            <label className={lbl}>Re-enter account number</label>
            <input className={inp} value={confirmNumber} inputMode="numeric" autoComplete="off"
              onChange={(e) => setConfirmNumber(e.target.value.replace(/\D/g, '').slice(0, 18))} />
            {mismatch && <p className="text-xs text-red-600 dark:text-red-400 mt-1">The two numbers do not match.</p>}
          </div>
          <div>
            <label className={lbl}>IFSC</label>
            <input className={inp} value={ifsc} maxLength={11}
              onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          </div>
          <div>
            <label className={lbl}>Account holder name</label>
            <input className={inp} value={holderName} onChange={(e) => setHolderName(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button disabled={!canSubmit || busy} onClick={submit}
              className="rounded-lg bg-secondary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Checking…' : 'Save and verify'}
            </button>
            {bank && (
              <button onClick={() => { setEditing(false); setError(null) }}
                className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-foreground">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
