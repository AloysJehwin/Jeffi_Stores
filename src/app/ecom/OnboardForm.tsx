'use client'

import { useState } from 'react'

interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

export default function OnboardForm({ plans }: { plans: Plan[] }) {
  const [planSlug, setPlanSlug] = useState(plans[0]?.slug || 'basic')
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [dailyPayout, setDailyPayout] = useState(false)
  const [wh, setWh] = useState({ originPincode: '', pickupLocation: '', sellerName: '', sellerAddress: '', sellerPhone: '' })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string; storefront?: string } | null>(null)

  const effectiveSlug = slugEdited ? slug : slugify(displayName)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/ecom/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: effectiveSlug, displayName, planSlug, dailyPayout, warehouse: wh }),
      })
      const data = await res.json()
      if (!res.ok) setResult({ ok: false, msg: data.error || 'Something went wrong.' })
      else setResult({ ok: true, msg: `Store created! Provisioning ${data.slug}.jeffistores.in`, storefront: data.storefront })
    } catch {
      setResult({ ok: false, msg: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500'

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-6 text-center">
        <h2 className="text-lg font-semibold text-green-800 dark:text-green-300">🎉 {result.msg}</h2>
        <p className="text-sm text-green-700 dark:text-green-400 mt-2">
          Your store is being set up. You&apos;ll be notified when it&apos;s live at{' '}
          <span className="font-mono">{result.storefront}</span>.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Plan selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Choose your plan</label>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {plans.map((p) => (
            <button
              type="button"
              key={p.slug}
              onClick={() => setPlanSlug(p.slug)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                planSlug === p.slug
                  ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="font-semibold text-gray-900 dark:text-white">{p.name}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}/mo</div>
            </button>
          ))}
        </div>
      </div>

      {/* Store name + slug */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Store name</label>
          <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Hardware" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subdomain</label>
          <div className="flex items-center gap-1">
            <input
              className={inputCls}
              value={effectiveSlug}
              onChange={(e) => { setSlugEdited(true); setSlug(slugify(e.target.value)) }}
              placeholder="acme"
              required
            />
            <span className="text-sm text-gray-400 whitespace-nowrap">.jeffistores.in</span>
          </div>
        </div>
      </div>

      {/* Warehouse (Delhivery pickup) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pickup warehouse (for deliveries)</label>
        <div className="grid sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="Origin pincode" value={wh.originPincode} onChange={(e) => setWh({ ...wh, originPincode: e.target.value })} />
          <input className={inputCls} placeholder="Pickup location name" value={wh.pickupLocation} onChange={(e) => setWh({ ...wh, pickupLocation: e.target.value })} />
          <input className={inputCls} placeholder="Seller / warehouse name" value={wh.sellerName} onChange={(e) => setWh({ ...wh, sellerName: e.target.value })} />
          <input className={inputCls} placeholder="Seller phone" value={wh.sellerPhone} onChange={(e) => setWh({ ...wh, sellerPhone: e.target.value })} />
          <input className={`${inputCls} sm:col-span-2`} placeholder="Warehouse address" value={wh.sellerAddress} onChange={(e) => setWh({ ...wh, sellerAddress: e.target.value })} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={dailyPayout} onChange={(e) => setDailyPayout(e.target.checked)} />
        Daily payouts (+5% fee) — otherwise weekly
      </label>

      {result && !result.ok && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {result.msg}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !displayName || !effectiveSlug}
        className="w-full rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white font-medium py-2.5 transition-colors"
      >
        {submitting ? 'Creating your store…' : 'Create my store'}
      </button>
    </form>
  )
}
