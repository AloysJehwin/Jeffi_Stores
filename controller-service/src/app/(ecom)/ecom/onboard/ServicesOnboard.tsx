'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eyebrow, Display, Pill } from '../_ui'
import AdminSelect from '@/components/admin/AdminSelect'
import { PhoneInput, isValidPhone } from '../_ui/phone'

// Short onboarding for messaging/documents-only customers: no plan, warehouse or bank step.
type Form = {
  displayName: string
  slug: string
  businessName: string
  businessType: string
  pan: string
  businessAddress: string
  gstNumber: string
  ownerName: string
  mobile: string
  legalsAccepted: boolean
}

const TYPES = [
  ['proprietor', 'Sole Proprietorship'],
  ['partnership', 'Partnership'],
  ['pvt_ltd', 'Private Limited'],
  ['llp', 'LLP'],
  ['other', 'Other'],
]
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// The input sits at the bottom of the (stretched) grid cell, so two fields in a row line up even when one has a hint.
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex h-full flex-col">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {hint && <span className="block text-xs text-foreground-muted mt-0.5">{hint}</span>}
      <div className="mt-auto pt-1.5">{children}</div>
    </label>
  )
}
const input = 'w-full rounded-xl bg-surface-elevated px-4 py-3 text-sm text-foreground ecom-field border-transparent'

export default function ServicesOnboard({ services, ownerName, onBack }: { services: ('messaging' | 'documents')[]; ownerName: string | null; onBack: () => void }) {
  const router = useRouter()
  const [f, setF] = useState<Form>({ displayName: '', slug: '', businessName: '', businessType: 'proprietor', pan: '', businessAddress: '', gstNumber: '', ownerName: ownerName ?? '', mobile: '', legalsAccepted: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }))

  const valid = f.displayName.length >= 2 && f.slug.length >= 3 && f.businessName.length >= 2 && f.pan.length === 10 && f.businessAddress.length >= 5 && (f.gstNumber === '' || f.gstNumber.length === 15) && f.ownerName && isValidPhone(f.mobile) && f.legalsAccepted

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/ecom/onboard/services', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, services, gstNumber: f.gstNumber || undefined }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(d.error ?? 'Something went wrong')
      setBusy(false)
      return
    }
    router.push('/dashboard/api-keys')
    router.refresh()
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onBack} className="org-square text-sm org-brown hover:underline mb-6">← Change services</button>
      <Eyebrow>{services.map(s => (s === 'messaging' ? 'Messaging API' : 'Documents API')).join(' + ')}</Eyebrow>
      <Display as="h1" className="mt-3 text-4xl">Set up your workspace</Display>
      <p className="mt-3 text-foreground-secondary">Takes about two minutes. Your workspace is live the moment you submit — no approval wait.</p>

      <div className="mt-8 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Workspace name"><input className={input} value={f.displayName} onChange={e => { set('displayName', e.target.value); if (!f.slug || f.slug === slugify(f.displayName)) set('slug', slugify(e.target.value)) }} placeholder="Nova Retail" /></Field>
          <Field label="Workspace handle" hint="Becomes your store address if you add one later"><div className="flex items-center gap-2"><input className={input} value={f.slug} onChange={e => set('slug', slugify(e.target.value))} placeholder="nova" /><span className="text-xs text-foreground-muted whitespace-nowrap">.jeffistores.in</span></div></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Legal business name"><input className={input} value={f.businessName} onChange={e => set('businessName', e.target.value)} /></Field>
          <Field label="Business type"><AdminSelect value={f.businessType} onChange={v => set('businessType', v)} options={TYPES.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="PAN"><input className={input} value={f.pan} onChange={e => set('pan', e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" /></Field>
          <Field label="GSTIN" hint="Optional — printed on invoices you generate"><input className={input} value={f.gstNumber} onChange={e => set('gstNumber', e.target.value.toUpperCase())} maxLength={15} /></Field>
        </div>
        <Field label="Business address"><textarea className={input} rows={2} value={f.businessAddress} onChange={e => set('businessAddress', e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Your name"><input className={input} value={f.ownerName} onChange={e => set('ownerName', e.target.value)} /></Field>
          <Field label="Mobile"><PhoneInput value={f.mobile} onChange={v => set('mobile', v)} inputClassName={`${input} min-w-0 flex-1`} /></Field>
        </div>
        <label className="flex items-start gap-3 text-sm text-foreground-secondary">
          <input type="checkbox" className="mt-1" checked={f.legalsAccepted} onChange={e => set('legalsAccepted', e.target.checked)} />
          <span>I agree to the Jeffi Commerce terms of service and acceptable-use policy for messaging.</span>
        </label>
        {error && <p className="text-sm text-[#8a2e1f] org-peach rounded-xl px-4 py-3">{error}</p>}
        <Pill onClick={submit} disabled={!valid || busy} className="px-8 py-4 text-base disabled:opacity-40">{busy ? 'Creating…' : 'Create workspace'}</Pill>
      </div>
    </div>
  )
}
