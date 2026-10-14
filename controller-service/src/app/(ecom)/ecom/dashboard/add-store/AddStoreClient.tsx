'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Card } from '../_components/Card'
import { fmt } from '../_components/finance'

export default function AddStoreClient({ plans, bankVerified }: { plans: { slug: string; name: string; monthly: number }[]; bankVerified: boolean }) {
  const router = useRouter()
  const [plan, setPlan] = useState(plans[0]?.slug ?? 'basic')
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function go() {
    setBusy(true); setErr(null)
    const r = await fetch('/api/ecom/services/add-store', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planSlug: plan, billingInterval: interval }) })
    const d = await r.json()
    if (!r.ok) { setErr(d.error); setBusy(false); return }
    router.refresh()
  }
  return (
    <div className="space-y-6">
      <Card title="Plan">
        <div className="flex gap-2 mb-4">{(['monthly', 'yearly'] as const).map(i => <button key={i} onClick={() => setInterval(i)} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${interval === i ? 'ecom-accent-bg text-white' : 'org-sand'}`}>{i}{i === 'yearly' && ' · 2 months free'}</button>)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{plans.map(p => <button key={p.slug} onClick={() => setPlan(p.slug)} className={`org-square text-left rounded-2xl p-4 ${plan === p.slug ? 'org-peach ring-2 ring-[var(--org-terracotta)]' : 'org-sand org-sand-hover'}`}><p className="font-display font-black text-lg">{p.name}</p><p className="text-sm">{fmt(interval === 'yearly' ? p.monthly * 10 : p.monthly)}<span className="text-foreground-muted">/{interval === 'yearly' ? 'yr' : 'mo'}</span></p></button>)}</div>
      </Card>
      <Card title="What happens next">
        <ol className="list-decimal ml-5 text-sm text-foreground-secondary space-y-1">
          <li>
            Verify a payout bank account (needed for settlements).{' '}
            {bankVerified
              ? <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Verified</span>
              : <Link href="/dashboard/payouts" className="font-semibold org-brown hover:underline">Verify now →</Link>}
          </li>
          <li>We review your business details (usually same day).</li>
          <li>Pay the first subscription charge; provisioning takes a few minutes.</li>
          <li>Your store and admin go live on <strong>your existing workspace</strong> — same wallet, same keys.</li>
        </ol>
        {err && <p className="mt-4 text-sm text-[#8a2e1f]">{err}</p>}
        {!bankVerified && <p className="mt-4 text-sm text-foreground-secondary">Verify your payout bank account first, then come back to request your store.</p>}
        <button onClick={go} disabled={busy || !bankVerified} className="ecom-accent-bg mt-5 rounded-full px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Submitting…' : 'Request my store'}</button>
      </Card>
    </div>
  )
}
