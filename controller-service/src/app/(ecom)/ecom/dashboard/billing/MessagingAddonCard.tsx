'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import type { MessagingAddonState } from '@controller/lib/ecom/messaging-addon-state'

type Channel = 'sms' | 'whatsapp'

const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'WhatsApp' }
const TIER_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', both: 'SMS & WhatsApp' } as const

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// SMS & WhatsApp add-on: one monthly service fee for the store's own sender numbers (message usage is
// billed from the wallet as before). A store sends only after buying it here and Jeffi assigning the numbers.
export default function MessagingAddonCard({ initial, tenantSlug }: { initial: MessagingAddonState; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const price = s.priceInr
  const short = s.balanceInr < price
  const covered: Channel[] = s.active ? (s.tier === 'both' ? ['sms', 'whatsapp'] : s.tier === 'none' ? [] : [s.tier]) : []
  // An older single-channel add-on can move to both channels.
  const partial = s.active && (s.tier === 'sms' || s.tier === 'whatsapp')

  async function act(body: { action: 'buy' } | { action: 'renew_on' | 'renew_off' }) {
    setBusy(true)
    try {
      const res = await fetch(`/api/ecom/billing/messaging-addon?tenant=${encodeURIComponent(tenantSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Could not update the add-on', 'error')
        return
      }
      setS(data)
      if (body.action === 'buy') showToast(`SMS & WhatsApp active until ${fmtDate(data.until)}`, 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const btn = 'px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const primary = `${btn} bg-accent-600 hover:bg-accent-700 text-white`
  const ghost = `${btn} border border-border-default text-foreground hover:bg-surface-secondary`

  const buy = (
    <div className="space-y-4">
      <p className="text-sm text-foreground-secondary">
        {inr(price)}/month from your wallet (balance {inr(s.balanceInr)}), renewing monthly until you turn it off. Messages you send
        {' '}are charged as usual. Jeffi then assigns your sender numbers; each channel switches on in Site Controls once its number is in place.
      </p>
      {short ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-foreground-muted">Your wallet is short of {inr(price)}.</span>
          <Link href={`/dashboard/wallet?tenant=${encodeURIComponent(tenantSlug)}`} className={`${primary} inline-block`}>
            Top up wallet
          </Link>
        </div>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-foreground">Pay {inr(price)} from your wallet now?</span>
          <button onClick={() => act({ action: 'buy' })} disabled={busy} className={primary}>
            {busy ? 'Paying…' : 'Confirm'}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} className={ghost}>
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className={primary}>
          {partial ? 'Switch to SMS & WhatsApp' : 'Add SMS & WhatsApp'} · {inr(price)}/month
        </button>
      )}
    </div>
  )

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">SMS & WhatsApp</h2>
      {s.active && s.until && s.tier !== 'none' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-lg font-bold text-foreground">
                {TIER_LABEL[s.tier]} until {fmtDate(s.until)}
              </div>
              <div className="text-sm text-foreground-muted mt-0.5">
                {s.renew ? `Renews automatically for ${inr(price)} from your wallet.` : 'Auto-renew is off. Sending switches off when this month ends.'}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => act({ action: s.renew ? 'renew_off' : 'renew_on' })} disabled={busy} className={ghost}>
                {s.renew ? 'Turn off auto-renew' : 'Turn on auto-renew'}
              </button>
            </div>
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
          {partial && buy}
        </div>
      ) : (
        <>
          <p className="text-sm text-foreground-secondary mb-4">Send OTPs, order updates and campaigns by SMS and WhatsApp from your own numbers.</p>
          {buy}
        </>
      )}
    </div>
  )
}
