'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card } from '../dashboard/_components/Card'
import { fieldInput, noteCls, primaryBtn } from './ui'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import { getStateCode } from '@/lib/catalog/gst'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { PhoneInput, isValidPhone } from '../_ui/phone'
import { ENTITY_TYPES, checkGstin, checkPan, idChars, type EntityType } from '@controller/lib/kyb/ids'
import { StateSelect } from './BusinessSteps'
import { SIGNATORY_TITLE } from './kyb'

// Short onboarding for messaging/documents-only customers: no plan, warehouse or bank step. It asks for the business
// details KYB needs (lib/kyb); the documents follow on the console's Business verification page, before anything is sent.
type Form = {
  displayName: string
  slug: string
  businessName: string
  entityType: EntityType | ''
  pan: string
  gstNumber: string
  addressLine: string
  city: string
  state: string
  pincode: string
  authorizedName: string
  authorizedDesignation: string
  ownerName: string
  mobile: string
  legalsAccepted: boolean
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
const errCls = 'mt-1 block text-xs text-[#8a2e1f]'

export default function ServicesOnboard({ services, ownerName, onBack }: { services: ('messaging' | 'documents')[]; ownerName: string | null; onBack: () => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [f, setF] = useState<Form>({
    displayName: '',
    slug: '',
    businessName: '',
    entityType: '',
    pan: '',
    gstNumber: '',
    addressLine: '',
    city: '',
    state: '',
    pincode: '',
    authorizedName: ownerName ?? '',
    authorizedDesignation: '',
    ownerName: ownerName ?? '',
    mobile: '',
    legalsAccepted: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }))
  // Shown once the field is left or full, not while it is typed.
  const [left, setLeft] = useState({ pan: false, gst: false })
  const panCheck = checkPan(f.pan, f.entityType || null)
  const gstCheck = f.gstNumber ? checkGstin(f.gstNumber, { pan: f.pan, state: f.state }) : null
  const panError = !!f.pan && !panCheck.ok && (left.pan || f.pan.length >= 10) ? panCheck.problem : null
  const gstError = gstCheck && !gstCheck.ok && (left.gst || f.gstNumber.length >= 15) ? gstCheck.problem : null

  const valid =
    f.displayName.length >= 2 &&
    f.slug.length >= 3 &&
    f.businessName.trim().length >= 2 &&
    !!f.entityType &&
    panCheck.ok &&
    (!gstCheck || gstCheck.ok) &&
    f.addressLine.trim().length >= 3 &&
    f.city.trim().length >= 2 &&
    !!getStateCode(f.state) &&
    /^[1-9][0-9]{5}$/.test(f.pincode) &&
    f.authorizedName.trim().length >= 2 &&
    f.authorizedDesignation.trim().length >= 2 &&
    !!f.ownerName &&
    isValidPhone(f.mobile) &&
    f.legalsAccepted

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/ecom/onboard/services', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, services, gstNumber: f.gstNumber || undefined }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError((d.fields && (Object.values(d.fields)[0] as string)) || d.error || 'Something went wrong')
      setBusy(false)
      return
    }
    showToast('Your workspace is ready. Sending starts once your business is verified: add your documents here.', 'info')
    router.push('/dashboard/business')
    router.refresh()
  }

  return (
    <div className="w-full">
      <button onClick={onBack} className="org-square min-h-11 sm:min-h-0 text-sm org-brown hover:underline mb-4">← Change services</button>
      <PageHeader
        eyebrow={services.map(s => (s === 'messaging' ? 'Messaging API' : 'Documents API')).join(' + ')}
        title="Set up your workspace"
        description="Takes about two minutes. You can explore your workspace straight away; sending starts once we verify your business."
      />

      <Card>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Workspace name"><input className={input} value={f.displayName} onChange={e => { set('displayName', e.target.value); if (!f.slug || f.slug === slugify(f.displayName)) set('slug', slugify(e.target.value)) }} /></Field>
          <Field label="Workspace handle" hint="Becomes your store address if you add one later"><div className="flex items-center gap-2"><input className={`${input} min-w-0`} value={f.slug} onChange={e => set('slug', slugify(e.target.value))} /><span className="shrink-0 text-xs text-foreground-muted whitespace-nowrap">.jeffistores.in</span></div></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Legal business name" hint="As on your PAN and registration"><input className={input} maxLength={200} value={f.businessName} onChange={e => set('businessName', e.target.value)} /></Field>
          <Field label="Business type" htmlFor="svc-entity">
            <AdminSelect
              id="svc-entity"
              value={f.entityType}
              placeholder="Pick a type"
              onChange={v => {
                const e = v as EntityType
                // The usual title follows the type until the owner types their own.
                setF(p => ({ ...p, entityType: e, authorizedDesignation: !p.authorizedDesignation.trim() || (p.entityType && p.authorizedDesignation === SIGNATORY_TITLE[p.entityType]) ? SIGNATORY_TITLE[e] : p.authorizedDesignation }))
              }}
              options={ENTITY_TYPES.map(t => ({ value: t.id, label: t.label }))}
            />
          </Field>
          <Field label="PAN" hint={f.entityType === 'proprietor' ? 'Your own PAN: a sole proprietorship has no separate one' : undefined}>
            <input className={input} value={f.pan} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={!!panError} onChange={e => set('pan', idChars(e.target.value, 10))} onBlur={() => setLeft(l => ({ ...l, pan: true }))} />
            {panError && <span className={errCls}>{panError}</span>}
          </Field>
          <Field label="GSTIN" hint="Optional. Printed on the invoices you generate">
            <input className={input} value={f.gstNumber} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={!!gstError} onChange={e => set('gstNumber', idChars(e.target.value, 15))} onBlur={() => setLeft(l => ({ ...l, gst: true }))} />
            {gstError && <span className={errCls}>{gstError}</span>}
          </Field>
        </div>
        <Field label="Registered address"><input className={input} maxLength={300} autoComplete="street-address" placeholder="Building, street and area" value={f.addressLine} onChange={e => set('addressLine', e.target.value)} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="City"><input className={input} maxLength={100} autoComplete="address-level2" value={f.city} onChange={e => set('city', e.target.value)} /></Field>
          <Field label="State" htmlFor="svc-state"><StateSelect id="svc-state" value={f.state} onChange={v => set('state', v)} /></Field>
          <Field label="PIN code">
            <input
              className={input}
              inputMode="numeric"
              maxLength={6}
              autoComplete="postal-code"
              value={f.pincode}
              onChange={e => {
                const pincode = e.target.value.replace(/\D/g, '').slice(0, 6)
                // The state follows from most PIN codes; one already picked stays.
                const state = !f.state && pincode.length === 6 ? stateFromPincode(pincode) : null
                setF(p => ({ ...p, pincode, ...(state ? { state } : {}) }))
              }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Authorised signatory" hint="Who signs for the business"><input className={input} maxLength={120} value={f.authorizedName} onChange={e => set('authorizedName', e.target.value)} /></Field>
          <Field label="Designation"><input className={input} maxLength={80} placeholder="e.g. Director" value={f.authorizedDesignation} onChange={e => set('authorizedDesignation', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Your name"><input className={input} value={f.ownerName} onChange={e => set('ownerName', e.target.value)} /></Field>
          <Field label="Mobile" htmlFor="svc-mobile"><PhoneInput id="svc-mobile" value={f.mobile} onChange={v => set('mobile', v)} inputClassName={`${input} min-w-0 flex-1`} /></Field>
        </div>
        <label className="flex items-start gap-3 text-sm text-foreground-secondary">
          <input type="checkbox" className="mt-1" checked={f.legalsAccepted} onChange={e => set('legalsAccepted', e.target.checked)} />
          <span>I agree to the Jeffi Commerce terms of service and acceptable-use policy for messaging.</span>
        </label>
        <p className="text-xs text-foreground-muted">Next, you upload your PAN card and GST certificate (or a registration proof) on the Business verification page.</p>
        {error && <p className={`${noteCls} org-peach text-[#8a2e1f]`}>{error}</p>}
      </div>
      </Card>
      <div className="mt-6">
        <button type="button" onClick={submit} disabled={!valid || busy} className={`${primaryBtn} w-full sm:w-auto px-6`}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </div>
    </div>
  )
}
