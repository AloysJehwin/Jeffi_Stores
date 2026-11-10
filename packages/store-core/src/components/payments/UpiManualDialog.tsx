'use client'

import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { UpiMark } from './PaymentSections'
import type { UpiManualState } from './useUpiPayment'

// Manual UPI: the customer pays the store's UPI ID (QR / deep link), then enters the UTR so staff can
// confirm. Self-contained so the storefront, business portal, admin and ecom host all render it alike.

const UTR_RE = /^[A-Za-z0-9]{12,22}$/

export function isValidUtr(v: string): boolean {
  return UTR_RE.test(v.trim())
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface UpiManualDialogProps {
  manual: UpiManualState | null
  busy?: boolean
  error?: string | null
  onConfirm: (utr: string) => void | Promise<unknown>
  onClose: () => void
}

export default function UpiManualDialog({ manual, busy, error, onConfirm, onClose }: UpiManualDialogProps) {
  const [utr, setUtr] = useState('')
  const [touched, setTouched] = useState(false)
  const [copied, setCopied] = useState(false)
  const titleId = useId()
  const open = !!manual

  useEffect(() => {
    if (!open) return
    setUtr('')
    setTouched(false)
    setCopied(false)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const valid = isValidUtr(utr)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manual.vpa)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!valid || busy) return
    void onConfirm(utr.trim().toUpperCase())
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <form
        onSubmit={submit}
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border-default bg-surface-elevated shadow-2xl sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-base font-bold text-foreground">
              <UpiMark className="h-6 w-auto text-foreground" /> Pay {inr(manual.amountPaise)}
            </h2>
            <p className="mt-0.5 text-xs text-foreground-muted">Pay from any UPI app, then enter the UTR so the store can confirm it.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-secondary hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {manual.qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={manual.qrDataUrl} alt={`UPI QR code for ${manual.vpa}`} width={160} height={160} className="h-40 w-40 shrink-0 rounded-lg border border-border-default bg-white p-2" />
            )}
            <dl className="min-w-0 flex-1 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-foreground-muted">Pay to</dt>
                <dd className="font-medium text-foreground">{manual.payeeName}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground-muted">UPI ID</dt>
                <dd className="flex items-center gap-2">
                  <code className="min-w-0 break-all font-mono text-sm text-foreground">{manual.vpa}</code>
                  <button
                    type="button"
                    onClick={copy}
                    aria-label={copied ? 'Copied' : 'Copy UPI ID'}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-default text-foreground-secondary hover:bg-surface-secondary"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-foreground-muted">Amount</dt>
                <dd className="font-semibold tabular-nums text-foreground">{inr(manual.amountPaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-foreground-muted">Reference</dt>
                <dd className="font-mono text-xs text-foreground">{manual.reference}</dd>
              </div>
              {manual.upiUri && (
                <a
                  href={manual.upiUri}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-accent-500 px-3 text-sm font-semibold text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/30 sm:hidden"
                >
                  Open UPI app
                </a>
              )}
            </dl>
          </div>

          <div>
            <label htmlFor={`${titleId}-utr`} className="mb-1.5 block text-sm font-medium text-foreground-secondary">
              UTR / transaction reference
            </label>
            <input
              id={`${titleId}-utr`}
              value={utr}
              onChange={e => setUtr(e.target.value.replace(/\s+/g, ''))}
              onBlur={() => setTouched(true)}
              autoFocus
              autoComplete="off"
              inputMode="text"
              maxLength={22}
              placeholder="12-digit UTR from your UPI app"
              aria-invalid={touched && !valid ? true : undefined}
              aria-describedby={`${titleId}-utr-hint`}
              className="h-10 w-full rounded-lg border border-border-secondary bg-surface px-3 font-mono text-sm text-foreground placeholder:text-foreground-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p id={`${titleId}-utr-hint`} className={`mt-1 text-xs ${touched && !valid ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
              {touched && !valid ? 'Enter the 12-digit UTR (or the 12–22 character transaction ID) shown in your UPI app.' : 'Found under the payment in your UPI app as UTR, RRN or transaction ID.'}
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border-default px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-sm font-medium text-foreground-secondary hover:text-foreground disabled:opacity-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || (touched && !valid)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? 'Recording…' : 'I have paid'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
