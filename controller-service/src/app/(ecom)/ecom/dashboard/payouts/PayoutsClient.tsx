'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

export interface BankState {
  last4: string | null
  ifsc: string | null
  holderName: string | null
  verifiedName: string | null
  verificationStatus: string | null
  verificationRef: string | null
  hasRouteAccount: boolean
  upiId: string | null
}

// Same shape check as the bank endpoints (lib/payments/bank-verify.ts).
const UPI_ID_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/

const STATE: Record<string, { label: string; tone: string; blurb: string }> = {
  verified: {
    label: 'Verified',
    tone: 'org-sage org-sage-text border-border-default',
    blurb: 'Your payouts settle to this account.',
  },
  unverified: {
    label: 'Awaiting verification',
    tone: 'org-sand org-brown border-border-default',
    blurb: 'Saved, but not yet confirmed by the payment provider. Payouts start once it is.',
  },
  failed: {
    label: 'Rejected',
    tone: 'org-sand text-[#8a2e1f] border-border-default',
    blurb: 'The payment provider would not accept this account. Payouts are on hold until it is corrected.',
  },
}

export default function PayoutsClient({ initial }: { initial: BankState | null }) {
  const { showToast } = useToast()
  const [bank, setBank] = useState<BankState | null>(initial)
  const [editing, setEditing] = useState(!initial)
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmNumber, setConfirmNumber] = useState('')
  const [ifsc, setIfsc] = useState(initial?.ifsc ?? '')
  const [holderName, setHolderName] = useState(initial?.holderName ?? '')
  const [upiId, setUpiId] = useState(initial?.upiId ?? '')
  const [editingUpi, setEditingUpi] = useState(false)
  const [upiDraft, setUpiDraft] = useState(initial?.upiId ?? '')
  const [busy, setBusy] = useState(false)

  const status = bank?.verificationStatus ?? 'unverified'
  const meta = STATE[status] ?? STATE.unverified
  const mismatch = confirmNumber.length > 0 && accountNumber !== confirmNumber
  const upiOk = !upiId || UPI_ID_RE.test(upiId)
  const canSubmit = accountNumber.length >= 9 && !mismatch && ifsc.length === 11 && holderName.trim().length > 0 && upiOk
  const upiDraftOk = !upiDraft || UPI_ID_RE.test(upiDraft)

  // UPI ID alone, without re-entering the account number.
  async function saveUpi() {
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/bank/upi', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upiId: upiDraft.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) showToast(data.error || 'Could not save the UPI ID.', 'error')
      else {
        setUpiId(upiDraft.trim())
        setBank(b => (b ? { ...b, upiId: upiDraft.trim() || null } : b))
        setEditingUpi(false)
        showToast(upiDraft.trim() ? 'UPI ID saved.' : 'UPI ID removed.', 'success')
      }
    } catch {
      showToast('Network error — please try again.', 'error')
    }
    setBusy(false)
  }

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/bank/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber, ifsc: ifsc.toUpperCase(), holderName, upiId: upiId.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.reason || data.error || 'Could not save those details.', 'error')
      } else {
        setBank({
          last4: accountNumber.slice(-4),
          ifsc: ifsc.toUpperCase(),
          holderName,
          verifiedName: data.verifiedName ?? null,
          verificationStatus: data.status ?? 'unverified',
          verificationRef: null,
          hasRouteAccount: !!data.pushedToRoute,
          upiId: upiId.trim() || null,
        })
        setUpiDraft(upiId.trim())
        showToast(
          data.pushedToRoute
            ? 'Updated with the payment provider.'
            : 'Saved. It will be sent to the payment provider when your store goes live.',
          'success'
        )
        setEditing(false)
        setAccountNumber('')
        setConfirmNumber('')
      }
    } catch {
      showToast('Network error — please try again.', 'error')
    }
    setBusy(false)
  }

  const inp = 'w-full rounded-xl border border-border-default bg-surface px-3 py-2 text-sm text-foreground ecom-field'
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
          <button
            onClick={() => setEditing(true)}
            className="mt-4 rounded-xl border border-border-default px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
          >
            {status === 'failed' ? 'Correct these details' : 'Change account'}
          </button>

          <div className="mt-5 border-t border-border-default pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">UPI ID</p>
                {!editingUpi && (
                  <p className="text-sm text-foreground-muted mt-1 font-mono break-all">{bank.upiId || 'Not added'}</p>
                )}
              </div>
              {!editingUpi && (
                <button
                  onClick={() => {
                    setUpiDraft(bank.upiId ?? '')
                    setEditingUpi(true)
                  }}
                  className="shrink-0 rounded-xl border border-border-default px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
                >
                  {bank.upiId ? 'Change' : 'Add'}
                </button>
              )}
            </div>
            {editingUpi ? (
              <div className="mt-2 space-y-2">
                <input
                  className={inp}
                  value={upiDraft}
                  placeholder="yourstore@okaxis"
                  autoCapitalize="none"
                  autoComplete="off"
                  onChange={e => setUpiDraft(e.target.value.trim())}
                />
                {!upiDraftOk && <p className="text-xs text-[#8a2e1f]">A UPI ID looks like name@bank.</p>}
                <div className="flex gap-2">
                  <button
                    disabled={busy || !upiDraftOk}
                    onClick={saveUpi}
                    className="rounded-xl bg-secondary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingUpi(false)}
                    className="rounded-xl border border-border-default px-4 py-2 text-sm font-medium text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-foreground-muted mt-2">
                Customers can pay this UPI ID directly when Jeffi enables manual UPI for your store. Connect a PhonePe Business account from your store admin to collect automatically.
              </p>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-5 space-y-4">
          <p className="text-sm font-semibold text-foreground">
            {bank ? 'Update settlement account' : 'Add a settlement account'}
          </p>
          <div>
            <label className={lbl}>Account number</label>
            <input
              className={inp}
              value={accountNumber}
              inputMode="numeric"
              autoComplete="off"
              onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
            />
          </div>
          <div>
            <label className={lbl}>Re-enter account number</label>
            <input
              className={inp}
              value={confirmNumber}
              inputMode="numeric"
              autoComplete="off"
              onChange={e => setConfirmNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
            />
            {mismatch && <p className="text-xs text-[#8a2e1f] mt-1">The two numbers do not match.</p>}
          </div>
          <div>
            <label className={lbl}>IFSC</label>
            <input
              className={inp}
              value={ifsc}
              maxLength={11}
              onChange={e => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div>
            <label className={lbl}>Account holder name</label>
            <input className={inp} value={holderName} onChange={e => setHolderName(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>UPI ID (optional)</label>
            <input
              className={inp}
              value={upiId}
              placeholder="yourstore@okaxis"
              autoCapitalize="none"
              autoComplete="off"
              onChange={e => setUpiId(e.target.value.trim())}
            />
            {!upiOk && <p className="text-xs text-[#8a2e1f] mt-1">A UPI ID looks like name@bank.</p>}
          </div>
          <div className="flex gap-2">
            <button
              disabled={!canSubmit || busy}
              onClick={submit}
              className="rounded-xl bg-secondary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Save and verify'}
            </button>
            {bank && (
              <button
                onClick={() => setEditing(false)}
                className="rounded-xl border border-border-default px-4 py-2 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
