'use client'

import { useId, useState, type ReactNode } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { Card } from '../_components/Card'
import { fieldInput, fieldLabel, ghostBtn, primaryBtn, secondaryBtn } from '../../onboard/ui'

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

// Why the form asks for a bank account at all.
const WHY = {
  store: "Your store's sales, and any refunds due to you, are paid out to this account.",
  none: 'Needed only once you sell: when you add a store, its sales and any refunds due to you are paid out here.',
}

export default function PayoutsClient({ initial, hasStore }: { initial: BankState | null; hasStore: boolean }) {
  const { showToast } = useToast()
  const id = useId()
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

  const field = (key: string, label: string, input: ReactNode, error?: ReactNode) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={fieldLabel}>{label}</label>
      {input}
      {error}
    </div>
  )

  return (
    <>
      {bank && !editing && (
        <Card
          title="Settlement account"
          action={<span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.tone}`}>{meta.label}</span>}
        >
          <p className="text-sm text-foreground font-mono">
            ••••{bank.last4} · {bank.ifsc}
          </p>
          <p className="text-sm text-foreground-muted">{bank.verifiedName || bank.holderName}</p>
          <p className="text-xs text-foreground-muted mt-3">{meta.blurb}</p>
          <button onClick={() => setEditing(true)} className={`${secondaryBtn} mt-4`}>
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
                  className={`${secondaryBtn} shrink-0`}
                >
                  {bank.upiId ? 'Change' : 'Add'}
                </button>
              )}
            </div>
            {editingUpi ? (
              <div className="mt-2 max-w-md space-y-2">
                <input
                  className={fieldInput}
                  value={upiDraft}
                  placeholder="yourstore@okaxis"
                  aria-label="UPI ID"
                  autoCapitalize="none"
                  autoComplete="off"
                  onChange={e => setUpiDraft(e.target.value.trim())}
                />
                {!upiDraftOk && <p className="text-xs text-[#8a2e1f]">A UPI ID looks like name@bank.</p>}
                <div className="flex gap-2">
                  <button disabled={busy || !upiDraftOk} onClick={saveUpi} className={primaryBtn}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingUpi(false)} className={ghostBtn}>
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
        </Card>
      )}

      {editing && (
        <Card title={bank ? 'Update settlement account' : 'Add a settlement account'}>
          <p className="mb-5 text-sm text-foreground-secondary">{hasStore ? WHY.store : WHY.none}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'acct',
              'Account number',
              <input
                id={`${id}-acct`}
                className={fieldInput}
                value={accountNumber}
                inputMode="numeric"
                autoComplete="off"
                onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
              />
            )}
            {field(
              'confirm',
              'Re-enter account number',
              <input
                id={`${id}-confirm`}
                className={fieldInput}
                value={confirmNumber}
                inputMode="numeric"
                autoComplete="off"
                onChange={e => setConfirmNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
              />,
              mismatch && <p className="text-xs text-[#8a2e1f] mt-1">The two numbers do not match.</p>
            )}
            {field(
              'ifsc',
              'IFSC',
              <input
                id={`${id}-ifsc`}
                className={fieldInput}
                value={ifsc}
                maxLength={11}
                onChange={e => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            )}
            {field(
              'holder',
              'Account holder name',
              <input id={`${id}-holder`} className={fieldInput} value={holderName} onChange={e => setHolderName(e.target.value)} />
            )}
            {field(
              'upi',
              'UPI ID (optional)',
              <input
                id={`${id}-upi`}
                className={fieldInput}
                value={upiId}
                placeholder="yourstore@okaxis"
                autoCapitalize="none"
                autoComplete="off"
                onChange={e => setUpiId(e.target.value.trim())}
              />,
              !upiOk && <p className="text-xs text-[#8a2e1f] mt-1">A UPI ID looks like name@bank.</p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button disabled={!canSubmit || busy} onClick={submit} className={primaryBtn}>
              {busy ? 'Checking…' : 'Save and verify'}
            </button>
            {bank && (
              <button onClick={() => setEditing(false)} className={ghostBtn}>
                Cancel
              </button>
            )}
          </div>
        </Card>
      )}
    </>
  )
}
