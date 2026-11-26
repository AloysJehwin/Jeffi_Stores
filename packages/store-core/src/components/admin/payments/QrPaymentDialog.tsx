'use client'

import { useEffect, useRef, useState } from 'react'
import { Dialog, FormButton } from '@/components/admin/kit'

export type QrIntentKind = 'invoice' | 'quotation_convert' | 'invoice_draft_finalise' | 'cash_sale'

export interface QrIntent {
  intentId: string
  qrImageUrl: string
  /** Rupees. */
  amount: number
  expiresAt: string
}

export interface QrResult {
  resultRef?: string | null
  resultUrl?: string | null
}

type IntentStatus = 'pending' | 'paid' | 'finalised' | 'expired' | 'cancelled' | 'failed'

const POLL_MS = 2500
const BASE = '/api/admin/payments/qr-intents'

/** POST qr-intents with the same payload the create call would send; throws a readable message on failure. */
export async function createQrIntent(kind: QrIntentKind, payload: Record<string, unknown>): Promise<QrIntent> {
  const res = await fetch(BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, payload }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || data?.message || 'Could not generate the payment QR')
  return data as QrIntent
}

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function remaining(expiresAt: string) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function QrPaymentDialog({
  intent,
  onClose,
  onDone,
  onNewQr,
}: {
  intent: QrIntent | null
  onClose: () => void
  onDone: (result: QrResult) => void
  onNewQr?: () => void
}) {
  const [status, setStatus] = useState<IntentStatus>('pending')
  const [error, setError] = useState('')
  const [secs, setSecs] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const doneFor = useRef<string | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const id = intent?.intentId
  const expiresAt = intent?.expiresAt

  useEffect(() => {
    setStatus('pending')
    setError('')
    setCancelling(false)
    doneFor.current = null
  }, [id])

  useEffect(() => {
    if (!expiresAt) return
    setSecs(remaining(expiresAt))
    const t = setInterval(() => setSecs(remaining(expiresAt)), 1000)
    return () => clearInterval(t)
  }, [expiresAt])

  const terminal = status === 'finalised' || status === 'failed' || status === 'expired' || status === 'cancelled'

  useEffect(() => {
    if (!id || terminal) return
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`${BASE}/${id}`, { credentials: 'include' })
        const data = await res.json().catch(() => ({}))
        if (stop || !res.ok) return
        const next = data.status as IntentStatus
        if (next === 'failed') setError(data.error || 'Unknown error')
        if (next === 'finalised' && doneFor.current !== id) {
          doneFor.current = id
          onDoneRef.current({ resultRef: data.resultRef, resultUrl: data.resultUrl })
        }
        if (next) setStatus(next)
      } catch {}
    }
    const t = setInterval(tick, POLL_MS)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [id, terminal])

  async function cancel() {
    if (!id) return
    setCancelling(true)
    try {
      await fetch(`${BASE}/${id}/cancel`, { method: 'POST', credentials: 'include' })
    } catch {}
    onClose()
  }

  if (!intent) return null

  const finalising = status === 'paid' || status === 'finalised'

  return (
    <Dialog open onClose={onClose} title="Scan to pay" size="sm" zIndex="z-[500]" dismissible={false} hideClose>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-2xl font-bold text-foreground">₹{inr(intent.amount)}</p>
        {(status === 'pending' || status === 'expired') && (
          <img
            src={intent.qrImageUrl}
            alt="UPI QR code"
            className={`w-full max-w-[240px] rounded-lg border border-border-default ${status === 'expired' ? 'opacity-30' : ''}`}
          />
        )}
        {status === 'pending' && (
          <>
            <p className="text-sm text-foreground-secondary" role="status">Waiting for payment…</p>
            <p className="text-xs text-foreground-muted">{secs > 0 ? `Expires in ${clock(secs)}` : 'Expiring…'}</p>
          </>
        )}
        {finalising && <p className="text-sm font-medium text-foreground" role="status">Paid — creating the invoice…</p>}
        {status === 'failed' && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">Paid. Couldn't create the invoice: {error}</p>
        )}
        {status === 'expired' && <p className="text-sm text-foreground-secondary" role="status">This QR has expired.</p>}
        {status === 'cancelled' && <p className="text-sm text-foreground-secondary" role="status">Payment cancelled.</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {status === 'pending' && (
          <FormButton type="button" variant="secondary" disabled={cancelling} onClick={cancel}>
            Cancel
          </FormButton>
        )}
        {status === 'expired' && onNewQr && (
          <FormButton type="button" onClick={onNewQr}>
            New QR
          </FormButton>
        )}
        {(status === 'expired' || status === 'failed' || status === 'cancelled') && (
          <FormButton type="button" variant="secondary" onClick={onClose}>
            Close
          </FormButton>
        )}
      </div>
    </Dialog>
  )
}
