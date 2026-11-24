'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import type { MessagingAddonState } from '@controller/lib/ecom/messaging-addon-state'

type Channel = 'sms' | 'whatsapp'

const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp' }
const TIER_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', both: 'SMS & WhatsApp' } as const

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// SMS & WhatsApp add-on: a monthly line on the workspace's subscription for the store's own sender numbers (message
// usage is billed from the wallet as before). A store sends only once it is on and Jeffi has assigned the numbers.
export default function MessagingAddonCard({ initial, tenantSlug }: { initial: MessagingAddonState; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const price = `${inr(s.priceInr)}/month`
  const covered: Channel[] = s.active ? (s.tier === 'both' ? ['sms', 'whatsapp'] : s.tier === 'none' ? [] : [s.tier]) : []
  const onBill = s.lineStatus === 'active' || s.lineStatus === 'trial' || s.lineStatus === 'ending' || s.lineStatus === 'legacy_wallet'
  // An older single-channel add-on can move to both channels.
  const partial = s.active && (s.tier === 'sms' || s.tier === 'whatsapp') && s.lineStatus !== 'awaiting_payment'

  async function act(action: 'add' | 'remove' | 'decline_request') {
    setBusy(true)
    let leaving = false
    try {
      const res = await fetch(`/api/ecom/billing/messaging-addon?tenant=${encodeURIComponent(tenantSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Could not update the add-on', 'error')
        return
      }
      if (data.checkoutUrl) {
        leaving = true
        showToast('Opening Razorpay to approve the payment…', 'info')
        window.location.href = data.checkoutUrl
        return
      }
      setS(data)
      if (action === 'add') showToast('SMS & WhatsApp added to your subscription', 'success')
      if (action === 'remove') showToast(data.endsAt ? `SMS & WhatsApp ends on ${fmtDate(data.endsAt)}` : 'SMS & WhatsApp removed', 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      if (!leaving) setBusy(false)
      setConfirming(false)
    }
  }

  const btn = 'inline-block px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const primary = `${btn} bg-accent-600 hover:bg-accent-700 text-white`
  const ghost = `${btn} border border-border-default text-foreground hover:bg-surface-secondary`

  const removeControl = confirming ? (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-foreground">Remove SMS & WhatsApp? Sending stays on until the paid cycle ends.</span>
      <button onClick={() => act('remove')} disabled={busy} className={primary}>
        {busy ? 'Removing…' : 'Remove'}
      </button>
      <button onClick={() => setConfirming(false)} disabled={busy} className={ghost}>
        Keep it
      </button>
    </div>
  ) : (
    <button onClick={() => setConfirming(true)} disabled={busy} className={ghost}>
      Remove
    </button>
  )

  const add = (
    <div className="space-y-4">
      <p className="text-sm text-foreground-secondary">
        {price} on your subscription. Messages you send are charged from your wallet as usual. Jeffi then assigns your sender numbers; each channel
        {' '}switches on in Site Controls once its number is in place.
      </p>
      <button onClick={() => act('add')} disabled={busy} className={primary}>
        {busy ? 'Adding…' : `${partial ? 'Switch to SMS & WhatsApp' : 'Add to subscription'} · ${price}`}
      </button>
    </div>
  )

  const tierLabel = s.tier === 'none' ? TIER_LABEL.both : TIER_LABEL[s.tier]
  let headline: string = tierLabel
  let sub = `On your subscription · ${price}.`
  let control: ReactNode = removeControl
  if (s.lineStatus === 'ending') {
    headline = s.endsAt ? `${tierLabel} until ${fmtDate(s.endsAt)}` : tierLabel
    sub = 'Removed from your subscription. Sending switches off when the paid cycle ends.'
    control = (
      <button onClick={() => act('add')} disabled={busy} className={primary}>
        Keep it · {price}
      </button>
    )
  } else if (s.lineStatus === 'legacy_wallet') {
    headline = s.until ? `${tierLabel} until ${fmtDate(s.until)}` : tierLabel
    sub = 'Paid from your wallet. Move it to your subscription to keep sending.'
    control = (
      <Link href={`/dashboard/billing/subscribe?tenant=${encodeURIComponent(tenantSlug)}`} className={primary}>
        Set up subscription
      </Link>
    )
  } else if (!onBill) {
    // Still entitled from before, with nothing on the subscription.
    sub = s.until ? `Active until ${fmtDate(s.until)}. Add it to your subscription to keep sending.` : 'Add it to your subscription to keep sending.'
    control = partial ? null : (
      <button onClick={() => act('add')} disabled={busy} className={primary}>
        Add to subscription · {price}
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">SMS & WhatsApp</h2>
      {s.lineStatus === 'awaiting_payment' ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-foreground">Waiting for your approval</div>
            <div className="text-sm text-foreground-muted mt-0.5">
              SMS & WhatsApp ({price}) is on your subscription. {s.checkoutUrl ? 'Approve the payment to switch it on.' : 'It switches on once the payment goes through.'}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {s.checkoutUrl && (
              <a href={s.checkoutUrl} className={primary}>
                Approve payment
              </a>
            )}
            {removeControl}
          </div>
        </div>
      ) : onBill || covered.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-foreground">{headline}</div>
              <div className="text-sm text-foreground-muted mt-0.5">{sub}</div>
            </div>
            {control && <div className="ml-auto flex flex-wrap gap-2">{control}</div>}
          </div>
          <ul className="space-y-1.5">
            {covered.map(ch => {
              const ok = s.entitlement[ch] === 'ok'
              return (
                <li key={ch} className="flex items-center gap-2 text-sm">
                  <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} aria-hidden />
                  <span className="font-medium text-foreground">{CHANNEL_LABEL[ch]}</span>
                  <span className="text-foreground-muted">{ok ? 'number assigned' : 'waiting for your number from Jeffi'}</span>
                </li>
              )
            })}
          </ul>
          {partial && add}
        </div>
      ) : (
        <>
          {s.requested && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3">
              <p className="min-w-0 flex-1 text-sm text-foreground">You chose this during signup — add it to your subscription below to switch it on.</p>
              <button onClick={() => act('decline_request')} disabled={busy} className="text-sm font-medium text-foreground-muted hover:text-foreground disabled:opacity-50">
                Not now
              </button>
            </div>
          )}
          <p className="text-sm text-foreground-secondary mb-4">
            Send OTPs, order updates and campaigns by SMS and WhatsApp from your own numbers. Includes two dedicated numbers: a customer-facing
            number for WhatsApp and SMS, and an admin-facing WhatsApp number where your team uses the store assistant.
          </p>
          {add}
        </>
      )}
    </div>
  )
}
