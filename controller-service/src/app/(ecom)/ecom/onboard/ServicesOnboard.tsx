'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card } from '../dashboard/_components/Card'
import { fieldInput, noteCls, primaryBtn } from './ui'
import AdminSelect from '@/components/admin/AdminSelect'
import { PhoneInput, isValidPhone } from '../_ui/phone'
import { GSTIN_MESSAGE, PAN_MESSAGE, isGstin, isPan, taxIdInput } from '@controller/lib/catalog/tax-ids'

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
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

// The input sits at the bottom of the (stretched) grid cell, so two fields in a row line up even when one has a hint.
function Field({ label, children, hint, htmlFor }: { label: string; children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex h-full flex-col">
      <span className="text-sm font-medium text-foreground-secondary">{label}</span>
      {hint && <span className="block text-xs text-foreground-muted mt-0.5">{hint}</span>}
      <div className="mt-auto pt-1.5">{children}</div>
    </label>
  )
}
const input = fieldInput

export default function ServicesOnboard({ services, ownerName, onBack }: { services: ('messaging' | 'documents')[]; ownerName: string | null; onBack: () => void }) {
  const router = useRouter()
  const [f, setF] = useState<Form>({ displayName: '', slug: '', businessName: '', businessType: 'proprietor', pan: '', businessAddress: '', gstNumber: '', ownerName: ownerName ?? '', mobile: '', legalsAccepted: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }))
  // Shown once the field is left or full, not while it is typed.
  const [left, setLeft] = useState({ pan: false, gst: false })
  const panError = !!f.pan && !isPan(f.pan) && (left.pan || f.pan.length >= 10)
  const gstError = !!f.gstNumber && !isGstin(f.gstNumber) && (left.gst || f.gstNumber.length >= 15)

  const valid = f.displayName.length >= 2 && f.slug.length >= 3 && f.businessName.length >= 2 && isPan(f.pan) && f.businessAddress.length >= 5 && (f.gstNumber === '' || isGstin(f.gstNumber)) && f.ownerName && isValidPhone(f.mobile) && f.legalsAccepted

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
    <div className="w-full">
      <button onClick={onBack} className="org-square min-h-11 sm:min-h-0 text-sm org-brown hover:underline mb-4">← Change services</button>
      <PageHeader
        eyebrow={services.map(s => (s === 'messaging' ? 'Messaging API' : 'Documents API')).join(' + ')}
        title="Set up your workspace"
        description="Takes about two minutes. Your workspace is live the moment you submit — no approval wait."
      />

      <Card>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Workspace name"><input className={input} value={f.displayName} onChange={e => { set('displayName', e.target.value); if (!f.slug || f.slug === slugify(f.displayName)) set('slug', slugify(e.target.value)) }} /></Field>
          <Field label="Workspace handle" hint="Becomes your store address if you add one later"><div className="flex items-center gap-2"><input className={`${input} min-w-0`} value={f.slug} onChange={e => set('slug', slugify(e.target.value))} /><span className="shrink-0 text-xs text-foreground-muted whitespace-nowrap">.jeffistores.in</span></div></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Legal business name"><input className={input} value={f.businessName} onChange={e => set('businessName', e.target.value)} /></Field>
          <Field label="Business type"><AdminSelect value={f.businessType} onChange={v => set('businessType', v)} options={TYPES.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="PAN">
            <input className={input} value={f.pan} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={panError} onChange={e => set('pan', taxIdInput(e.target.value, 10))} onBlur={() => setLeft(l => ({ ...l, pan: true }))} />
            {panError && <span className="mt-1 block text-xs text-[#8a2e1f]">{PAN_MESSAGE}</span>}
          </Field>
          <Field label="GSTIN" hint="Optional — printed on invoices you generate">
            <input className={input} value={f.gstNumber} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={gstError} onChange={e => set('gstNumber', taxIdInput(e.target.value, 15))} onBlur={() => setLeft(l => ({ ...l, gst: true }))} />
            {gstError && <span className="mt-1 block text-xs text-[#8a2e1f]">{GSTIN_MESSAGE}</span>}
          </Field>
        </div>
        <Field label="Business address"><textarea className={input} rows={2} value={f.businessAddress} onChange={e => set('businessAddress', e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Your name"><input className={input} value={f.ownerName} onChange={e => set('ownerName', e.target.value)} /></Field>
          <Field label="Mobile" htmlFor="svc-mobile"><PhoneInput id="svc-mobile" value={f.mobile} onChange={v => set('mobile', v)} inputClassName={`${input} min-w-0 flex-1`} /></Field>
        </div>
        <label className="flex items-start gap-3 text-sm text-foreground-secondary">
          <input type="checkbox" className="mt-1" checked={f.legalsAccepted} onChange={e => set('legalsAccepted', e.target.checked)} />
          <span>I agree to the Jeffi Commerce terms of service and acceptable-use policy for messaging.</span>
        </label>
        {error && <p className={`${noteCls} org-peach text-[#8a2e1f]`}>{error}</p>}
      </div>
      </Card>
      <div className="mt-6">
        <button type="button" onClick={submit} disabled={!valid || busy} className={`${primaryBtn} w-full sm:w-auto px-6`}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </div>
    </div>
  )
}
