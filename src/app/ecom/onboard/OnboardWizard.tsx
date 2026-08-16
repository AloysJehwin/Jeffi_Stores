'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckMark } from '../Shapes'

interface Plan { slug: string; name: string; tier: number; monthly_price_inr: string }

const STEPS = ['Plan', 'Store', 'Warehouse', 'Bank', 'Review'] as const
type StepIdx = 0 | 1 | 2 | 3 | 4

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

const input = 'w-full rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
const label = 'block text-sm font-medium text-foreground-secondary mb-1'

export default function OnboardWizard({ plans }: { plans: Plan[] }) {
  const router = useRouter()
  const [step, setStep] = useState<StepIdx>(0)
  const [planSlug, setPlanSlug] = useState(plans[0]?.slug || 'basic')
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [dailyPayout, setDailyPayout] = useState(false)
  const [wh, setWh] = useState({ originPincode: '', pickupLocation: '', sellerName: '', sellerAddress: '', sellerPhone: '' })
  const [bank, setBank] = useState({ accountNumber: '', ifsc: '', holderName: '', upiId: '' })
  const [bankVerified, setBankVerified] = useState(false)
  const [bankMsg, setBankMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ storefront: string; slug: string } | null>(null)

  const effectiveSlug = slugEdited ? slug : slugify(displayName)
  const selectedPlan = plans.find((p) => p.slug === planSlug)

  function canNext(): boolean {
    if (step === 0) return !!planSlug
    if (step === 1) return displayName.trim().length > 0 && effectiveSlug.length >= 3
    if (step === 2) return true // warehouse optional
    if (step === 3) return bankVerified
    return true
  }

  async function verifyBank() {
    setBusy(true); setBankMsg(null)
    try {
      const res = await fetch('/api/ecom/bank/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bank),
      })
      const data = await res.json()
      if (res.ok && data.status === 'verified') {
        setBankVerified(true); setBankMsg({ ok: true, text: `Verified — account holder: ${data.verifiedName}` })
      } else {
        setBankVerified(false); setBankMsg({ ok: false, text: data.reason || data.error || 'Verification failed' })
      }
    } catch { setBankMsg({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ecom/onboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: effectiveSlug, displayName, planSlug, dailyPayout, warehouse: wh }),
      })
      const data = await res.json()
      if (!res.ok) setErr(data.error || 'Failed to create store')
      else setDone({ storefront: data.storefront, slug: data.slug })
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-8 text-center">
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-600 text-white mx-auto mb-4"><CheckMark className="w-7 h-7" /></span>
        <h2 className="text-xl font-semibold text-green-800 dark:text-green-300">Your store is being set up</h2>
        <p className="text-sm text-green-700 dark:text-green-400 mt-2">{done.slug}.jeffistores.in — you&apos;ll be notified when it&apos;s live.</p>
        <button onClick={() => { router.push('/dashboard'); router.refresh() }} className="mt-5 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium">Go to dashboard</button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress */}
      <ol className="flex items-center justify-between mb-8">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1 flex items-center">
            <div className={`flex items-center gap-2 ${i <= step ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border ${i < step ? 'bg-accent-600 text-white border-accent-600' : i === step ? 'border-accent-600' : 'border-border-default'}`}>
                {i < step ? <CheckMark className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className="hidden sm:inline text-sm">{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-accent-600' : 'bg-border-default'}`} />}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6 sm:p-8">
        {step === 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Choose your plan</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {plans.map((p) => (
                <button key={p.slug} type="button" onClick={() => setPlanSlug(p.slug)}
                  className={`rounded-xl border p-3 text-left transition-colors ${planSlug === p.slug ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'}`}>
                  <div className="font-semibold text-foreground">{p.name}</div>
                  <div className="text-sm text-foreground-muted">₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}/mo</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Name your store</h2>
            <div><label className={label}>Store name</label>
              <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Hardware" /></div>
            <div><label className={label}>Subdomain</label>
              <div className="flex items-center gap-1">
                <input className={input} value={effectiveSlug} onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)) }} placeholder="acme" />
                <span className="text-sm text-foreground-muted whitespace-nowrap">.jeffistores.in</span>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Pickup warehouse</h2>
            <p className="text-sm text-foreground-muted">Where Delhivery picks up orders. You can edit this later.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <input className={input} placeholder="Origin pincode" value={wh.originPincode} onChange={(e) => setWh({ ...wh, originPincode: e.target.value })} />
              <input className={input} placeholder="Pickup location name" value={wh.pickupLocation} onChange={(e) => setWh({ ...wh, pickupLocation: e.target.value })} />
              <input className={input} placeholder="Seller / warehouse name" value={wh.sellerName} onChange={(e) => setWh({ ...wh, sellerName: e.target.value })} />
              <input className={input} placeholder="Seller phone" value={wh.sellerPhone} onChange={(e) => setWh({ ...wh, sellerPhone: e.target.value })} />
              <input className={`${input} sm:col-span-2`} placeholder="Warehouse address" value={wh.sellerAddress} onChange={(e) => setWh({ ...wh, sellerAddress: e.target.value })} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Verify your payout bank account</h2>
            <p className="text-sm text-foreground-muted">Required before go-live — this is where your sales settle. We verify it with a ₹1 penny-drop.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <input className={input} placeholder="Account holder name" value={bank.holderName} onChange={(e) => { setBank({ ...bank, holderName: e.target.value }); setBankVerified(false) }} />
              <input className={input} placeholder="Account number" value={bank.accountNumber} onChange={(e) => { setBank({ ...bank, accountNumber: e.target.value }); setBankVerified(false) }} />
              <input className={input} placeholder="IFSC" value={bank.ifsc} onChange={(e) => { setBank({ ...bank, ifsc: e.target.value.toUpperCase() }); setBankVerified(false) }} />
              <input className={input} placeholder="or UPI ID (optional)" value={bank.upiId} onChange={(e) => { setBank({ ...bank, upiId: e.target.value }); setBankVerified(false) }} />
            </div>
            <button type="button" onClick={verifyBank} disabled={busy || bankVerified}
              className="px-4 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:opacity-50 text-white text-sm font-medium">
              {bankVerified ? 'Verified' : busy ? 'Verifying…' : 'Verify account'}
            </button>
            {bankMsg && <p className={`text-sm ${bankMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{bankMsg.text}</p>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Review &amp; confirm</h2>
            <Row k="Plan" v={`${selectedPlan?.name} — ₹${Number(selectedPlan?.monthly_price_inr).toLocaleString('en-IN')}/mo`} />
            <Row k="Store" v={displayName} />
            <Row k="Subdomain" v={`${effectiveSlug}.jeffistores.in`} />
            <Row k="Payout" v={dailyPayout ? 'Daily (+5%)' : 'Weekly'} />
            <Row k="Bank" v={bankVerified ? 'Verified' : 'Not verified'} />
            <label className="flex items-center gap-2 text-sm text-foreground-secondary pt-2">
              <input type="checkbox" checked={dailyPayout} onChange={(e) => setDailyPayout(e.target.checked)} />
              Daily payouts (+5% fee) — otherwise weekly
            </label>
            {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          </div>
        )}

        {/* Nav */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border-default">
          <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1) as StepIdx)} disabled={step === 0}
            className="px-4 py-2 rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 text-sm">← Back</button>
          {step < 4 ? (
            <button type="button" onClick={() => canNext() && setStep((s) => (s + 1) as StepIdx)} disabled={!canNext()}
              className="px-5 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium">Continue</button>
          ) : (
            <button type="button" onClick={submit} disabled={busy || !bankVerified}
              className="px-5 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium">
              {busy ? 'Creating…' : 'Create my store'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm border-b border-border-default py-2">
      <span className="text-foreground-muted">{k}</span>
      <span className="text-foreground font-medium">{v}</span>
    </div>
  )
}
