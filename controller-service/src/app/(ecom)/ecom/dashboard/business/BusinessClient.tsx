'use client'

import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { ENTITY_TYPES, PAN_HOLDERS, checkGstin, checkPan, gstinParts, idChars, isEntityType } from '@controller/lib/kyb/ids'
import {
  GST_EXEMPT_REASONS,
  INDIAN_STATES,
  KYB_DOCS,
  MESSAGING_POLICY_VERSION,
  MESSAGING_PURPOSES,
  MESSAGING_VOLUMES,
  REGISTRATION_DOCS,
  SIGNATORY_TITLE,
  canonicalState,
  registrationDocsFor,
  websiteProblem,
  type ItemStatus,
  type KybService,
} from '@controller/lib/kyb/requirements'
import type { KybView } from '@controller/lib/kyb/view'
import { ChoiceCards, ChoiceChips } from '../../_ui'
import { PhoneInput, isValidPhone } from '../../_ui/phone'
import { Badge, fieldInput, fieldLabel, noteCls, primaryBtn } from '../../onboard/ui'
import { putKyb, kybCall } from './api'
import DocCard from './DocCard'
import { ITEM_BADGE, VerificationChecklist } from './KybChecklist'

// The console's Business verification: one checklist of what each service needs, then every section of the KYB
// answers with its documents and their automatic checks. Checks still running are polled until they finish.

type Profile = KybView['profile']
type Section = 'details' | 'pan' | 'gst' | 'website' | 'messaging'

const errCls = 'mt-1 text-xs text-[#8a2e1f]'
const lockedInput = 'w-full cursor-not-allowed rounded-xl border border-border-default bg-surface-secondary px-3.5 py-2.5 text-[16px] text-foreground-secondary focus:outline-none sm:text-sm'
const LOCKED = 'Verified by Jeffi. Contact support to change this.'
const POLL_MS = 3000
const MAX_POLLS = 60

const stateOption = (v: string) => canonicalState(v) || v.trim()
const GST_REASONS = GST_EXEMPT_REASONS.map(r => ({ value: r.id, label: r.label }))

const POLICY = [
  'Message only people who agreed to hear from you, and stop when they ask you to.',
  'Send offers and promotions only to people who opted in to them.',
  'Nothing misleading, illegal or abusive, and never pretend to be someone else.',
  'Jeffi may pause sending if people complain or messages keep failing.',
]

type DetailKey = 'legalName' | 'tradeName' | 'entityType' | 'addressLine' | 'city' | 'state' | 'pincode' | 'authorizedName' | 'authorizedDesignation' | 'mobile'
type Details = Record<DetailKey, string>
const DETAIL_KEYS: DetailKey[] = ['legalName', 'tradeName', 'entityType', 'addressLine', 'city', 'state', 'pincode', 'authorizedName', 'authorizedDesignation', 'mobile']
const DETAIL_RULES: Partial<Record<DetailKey, [(v: string) => boolean, string]>> = {
  legalName: [v => v.trim().length >= 2, 'Enter the legal name.'],
  entityType: [v => isEntityType(v), 'Pick the business type.'],
  addressLine: [v => v.trim().length >= 3, 'Enter the address.'],
  city: [v => v.trim().length >= 2, 'Enter the city.'],
  state: [v => v.trim().length >= 2, 'Pick the state.'],
  pincode: [v => /^[1-9][0-9]{5}$/.test(v.trim()), 'Enter the 6-digit PIN code.'],
  authorizedName: [v => v.trim().length >= 2, 'Enter who signs for the business.'],
  mobile: [v => !v || isValidPhone(v), 'Enter a valid mobile number.'],
}

const str = (v: string | null | undefined) => v ?? ''
const detailsFrom = (p: Profile): Details => ({
  legalName: str(p.legalName),
  tradeName: str(p.tradeName),
  entityType: isEntityType(p.entityType) ? p.entityType : '',
  addressLine: str(p.addressLine),
  city: str(p.city),
  state: stateOption(str(p.state)),
  pincode: str(p.pincode),
  authorizedName: str(p.authorizedName),
  authorizedDesignation: str(p.authorizedDesignation),
  mobile: str(p.mobile),
})

type Gst = { registered: boolean | null; gstin: string; reason: string; note: string }
const gstFrom = (p: Profile): Gst => ({ registered: p.gstRegistered, gstin: str(p.gstin), reason: str(p.gstExemptReason), note: str(p.gstExemptNote) })

type Usage = { purposes: string[]; volume: string; optIn: string; sample: string; accept: boolean }
const usageFrom = (p: Profile): Usage => {
  const m = p.messagingUse ?? {}
  return { purposes: m.purposes ?? [], volume: m.volume ?? '', optIn: m.optIn ?? '', sample: m.sample ?? '', accept: m.policyVersion === MESSAGING_POLICY_VERSION && !!m.acceptedAt }
}
const usageKey = (u: Usage) => JSON.stringify([[...u.purposes].sort(), u.volume, u.optIn.trim(), u.sample.trim(), u.accept])
const readyKey = (v: KybView) => (Object.keys(v.services) as KybService[]).map(s => `${s}:${v.services[s].ready}`).join(',')

function Block({ id, title, item, description, children }: { id: string; title: string; item?: ItemStatus; description?: ReactNode; children: ReactNode }) {
  const badge = item ? ITEM_BADGE[item.state] : null
  // Only a problem to fix: what is still to do is the section itself.
  const fix = item?.problem && (item.state === 'invalid' || item.state === 'rejected')
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-2xl border border-border-default bg-surface-elevated p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${id}-title`} className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">
          {title}
        </h2>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      {description && <p className="mt-2 max-w-2xl text-sm text-foreground-secondary">{description}</p>}
      {fix && <p className="mt-2 text-sm text-[#8a2e1f]">{item!.problem}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Field({ id, label, optional, hint, error, className = '', children }: { id: string; label: string; optional?: boolean; hint?: ReactNode; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && <span className="font-normal text-foreground-muted"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className={errCls}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-foreground-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** aria props for an input whose Field shows an error or a hint. */
const described = (id: string, error?: string, hint?: unknown) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
})

function TextField({ id, label, value, onChange, error, hint, locked, optional, className, input }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: ReactNode
  locked?: boolean
  optional?: boolean
  className?: string
  input?: InputHTMLAttributes<HTMLInputElement>
}) {
  const note = locked ? LOCKED : hint
  return (
    <Field id={id} label={label} optional={optional} hint={note} error={error} className={className}>
      <input
        id={id}
        className={locked ? lockedInput : fieldInput}
        value={value}
        readOnly={locked}
        onChange={e => onChange(e.target.value)}
        {...described(id, error, note)}
        {...input}
      />
    </Field>
  )
}

function SaveRow({ dirty, busy, onSave, error, label = 'Save' }: { dirty: boolean; busy: boolean; onSave: () => void; error?: string; label?: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" className={primaryBtn} disabled={!dirty || busy} onClick={onSave}>
        {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {busy ? 'Saving…' : label}
      </button>
      {dirty && !busy && <span className="text-xs text-foreground-muted">Unsaved changes</span>}
      {error && <p className="w-full text-sm text-[#8a2e1f]">{error}</p>}
    </div>
  )
}

export default function BusinessClient({ initial, focus, slug, hasStore, today }: { initial: KybView; focus: KybService | null; slug: string; hasStore: boolean; today: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [kyb, setKyb] = useState(initial)
  const [details, setDetails] = useState(() => detailsFrom(initial.profile))
  const [pan, setPan] = useState(str(initial.profile.pan))
  const [panLeft, setPanLeft] = useState(false)
  const [gst, setGst] = useState(() => gstFrom(initial.profile))
  const [gstinLeft, setGstinLeft] = useState(false)
  const [regPick, setRegPick] = useState<string | null>(null)
  const [website, setWebsite] = useState(str(initial.profile.website))
  const [usage, setUsage] = useState(() => usageFrom(initial.profile))
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Section | null>(null)
  const [polls, setPolls] = useState(0)
  // Bumped by every answer a write brings, so a poll that started before it can't put older data back.
  const gen = useRef(0)
  const lastReady = useRef(readyKey(initial))

  const apply = (next: KybView) => {
    gen.current++
    setKyb(next)
    setPolls(0)
  }

  const pending = kyb.docs.some(d => d.analysisStatus === 'pending')
  useEffect(() => {
    if (!pending || polls >= MAX_POLLS) return
    const t = setTimeout(async () => {
      const g = gen.current
      const r = await kybCall('/api/ecom/kyb')
      if (r.ok && g === gen.current) {
        gen.current++
        setKyb(r.kyb)
      }
      setPolls(n => n + 1)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [pending, polls])

  // A service becoming ready (or not) changes the console's banner and the Services page.
  useEffect(() => {
    const k = readyKey(kyb)
    if (k === lastReady.current) return
    lastReady.current = k
    router.refresh()
  }, [kyb, router])

  const locked = new Set(kyb.locked)
  const p = kyb.profile
  const saved = detailsFrom(p)
  const clear = (...keys: string[]) => setErrs(e => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.some(x => k === x || k.startsWith(`${x}.`)))))

  async function save(section: Section, body: Record<string, unknown>, keys: string[], done: string): Promise<KybView | null> {
    setSaving(section)
    const r = await putKyb(body)
    setSaving(null)
    clear(...keys)
    if (!r.ok) {
      const mine = Object.keys(r.fields).some(k => keys.some(x => k === x || k.startsWith(`${x}.`)))
      setErrs(e => ({ ...e, ...r.fields }))
      if (!mine) showToast(r.error, 'error')
      return null
    }
    apply(r.kyb)
    showToast(done, 'success')
    return r.kyb
  }

  // ── Business details ──
  const changedDetails = DETAIL_KEYS.filter(k => !locked.has(k) && details[k].trim() !== saved[k].trim())
  const setDetail = (k: DetailKey, v: string) => {
    setDetails(d => ({ ...d, [k]: v }))
    clear(k)
  }
  // The usual title follows the business type until the owner types their own, as in the wizard.
  const setEntity = (v: string) => {
    setDetails(d => {
      const usual = isEntityType(d.entityType) ? SIGNATORY_TITLE[d.entityType] : ''
      const follows = isEntityType(v) && (!d.authorizedDesignation.trim() || d.authorizedDesignation === usual)
      return { ...d, entityType: v, ...(follows ? { authorizedDesignation: SIGNATORY_TITLE[v] } : {}) }
    })
    clear('entityType', 'authorizedDesignation')
  }
  async function saveDetails() {
    const bad = Object.fromEntries(changedDetails.flatMap(k => (DETAIL_RULES[k] && !DETAIL_RULES[k]![0](details[k]) ? [[k, DETAIL_RULES[k]![1]]] : [])))
    if (Object.keys(bad).length) return setErrs(e => ({ ...e, ...bad }))
    // Every filled-in field goes, not only the changed ones: answers carried over from an older application (an
    // address read off the one-line address) are only derived until saved.
    const sent = DETAIL_KEYS.filter(k => !locked.has(k) && (details[k].trim() || changedDetails.includes(k)))
    const body = Object.fromEntries(sent.map(k => [k, details[k].trim() || null]))
    const next = await save('details', body, DETAIL_KEYS, 'Business details saved.')
    if (next) setDetails(detailsFrom(next.profile))
  }

  // ── PAN ── (checked against the saved business type, as the server does)
  const savedEntity = isEntityType(p.entityType) ? p.entityType : null
  const draftEntity = isEntityType(details.entityType) ? details.entityType : null
  const panEntity = savedEntity ?? draftEntity
  const panValue = idChars(pan, 10)
  const panCheck = checkPan(panValue, panEntity)
  const panLocked = locked.has('pan')
  const panError = errs.pan || (!panLocked && panValue && (panLeft || panValue.length >= 10) && !panCheck.ok ? panCheck.problem : undefined)
  const panDirty = !panLocked && panValue !== str(p.pan)
  async function savePan() {
    setPanLeft(true)
    if (!panCheck.ok) return
    const next = await save('pan', { pan: panValue }, ['pan'], 'PAN saved.')
    if (next) setPan(str(next.profile.pan))
  }

  // ── GST ── (the GSTIN must carry the saved PAN and the saved state's code)
  const savedGst = gstFrom(p)
  const gstinValue = idChars(gst.gstin, 15)
  const expectPan = p.pan ?? (checkPan(panValue).ok ? panValue : null)
  const expectState = p.state || details.state || null
  const gstinCheck = checkGstin(gstinValue, { pan: expectPan, state: expectState })
  const gstinLocked = locked.has('gstin')
  const registeredLocked = locked.has('gstRegistered')
  const gstinError = errs.gstin || (!gstinLocked && gstinValue && (gstinLeft || gstinValue.length >= 15) && !gstinCheck.ok ? gstinCheck.problem : undefined)
  const gstDirty =
    (!registeredLocked && gst.registered !== savedGst.registered) ||
    (gst.registered === true && !gstinLocked && gstinValue !== savedGst.gstin) ||
    (gst.registered === false && (gst.reason !== savedGst.reason || gst.note.trim() !== savedGst.note.trim()))
  const setG = (patch: Partial<Gst>, ...keys: string[]) => {
    setGst(g => ({ ...g, ...patch }))
    clear(...keys)
  }
  async function saveGst() {
    if (gst.registered === null) return setErrs(e => ({ ...e, gstRegistered: 'Tell us whether the business is registered for GST.' }))
    const body: Record<string, unknown> = {}
    if (!registeredLocked) body.gstRegistered = gst.registered
    if (gst.registered) {
      if (!gstinLocked) {
        setGstinLeft(true)
        if (!gstinValue) return setErrs(e => ({ ...e, gstin: 'Enter your GSTIN.' }))
        if (!gstinCheck.ok) return
        body.gstin = gstinValue
      }
    } else {
      if (!gst.reason) return setErrs(e => ({ ...e, gstExemptReason: 'Tell us why the business isn’t registered for GST.' }))
      body.gstExemptReason = gst.reason
      body.gstExemptNote = gst.note.trim() || null
    }
    const next = await save('gst', body, ['gstRegistered', 'gstin', 'gstExemptReason', 'gstExemptNote'], 'GST details saved.')
    if (next) setGst(gstFrom(next.profile))
  }

  // ── Website and messaging ──
  const suggested = hasStore ? `https://${slug}.jeffistores.in` : null
  const websiteDirty = website.trim() !== str(p.website)
  async function saveWebsite() {
    const w = website.trim()
    const problem = websiteProblem(w)
    if (problem) return setErrs(e => ({ ...e, website: problem }))
    const next = await save('website', { website: w }, ['website'], 'Website saved.')
    if (next) setWebsite(str(next.profile.website))
  }
  const savedUsage = usageFrom(p)
  const usageDirty = usageKey(usage) !== usageKey(savedUsage)
  const setU = <K extends keyof Usage>(k: K, v: Usage[K]) => {
    setUsage(u => ({ ...u, [k]: v }))
    clear(`messagingUse.${k}`, 'messagingUse')
  }
  async function saveUsage() {
    const bad: Record<string, string> = {}
    if (!usage.purposes.length) bad['messagingUse.purposes'] = 'Pick what you will send.'
    if (!usage.volume) bad['messagingUse.volume'] = 'Pick how many messages you expect to send.'
    if (usage.optIn.trim().length < 15) bad['messagingUse.optIn'] = 'Describe how people agree to receive your messages.'
    if (usage.sample.trim().length < 10) bad['messagingUse.sample'] = 'Add one message you will send.'
    if (!usage.accept) bad['messagingUse.accept'] = 'Accept the messaging policy.'
    if (Object.keys(bad).length) return setErrs(e => ({ ...e, ...bad }))
    const next = await save('messaging', { messagingUse: { ...usage, optIn: usage.optIn.trim(), sample: usage.sample.trim() } }, ['messagingUse'], 'Saved how you will message people.')
    if (next) setUsage(usageFrom(next.profile))
  }

  // ── Documents ──
  const docOf = (t: string) => kyb.docs.find(d => d.docType === t)
  const stalled = pending && polls >= MAX_POLLS
  const nameBlock = !p.legalName ? 'Save your business details first: documents are checked against your legal name.' : null
  const docProps = { today, stalled, onKyb: apply }
  const regOptions = registrationDocsFor(savedEntity)
  const regDocs = kyb.docs.filter(d => REGISTRATION_DOCS.includes(d.docType))
  const regUsed = regOptions.some(o => regDocs.some(d => d.docType === o))
  const regChoice = regPick && regOptions.includes(regPick) ? regPick : regOptions.length === 1 ? regOptions[0] : null
  const entityLabel = (ENTITY_TYPES.find(e => e.id === savedEntity)?.label ?? 'business').toLowerCase()
  const regCards = regDocs.map(d => (
    <DocCard
      key={d.docType}
      docType={d.docType}
      doc={d}
      removable
      note={savedEntity && !regOptions.includes(d.docType) ? `This proof doesn’t suit a ${entityLabel}. Remove it and upload one that does.` : null}
      blocked={nameBlock}
      {...docProps}
    />
  ))

  // Every API service, and the store when there is one; the one a link asked about (?for=) first.
  const ORDER: KybService[] = ['messaging', 'documents', 'store']
  const shown = ORDER.filter(s => s !== 'store' || kyb.services.store?.active).sort((a, b) => Number(b === focus) - Number(a === focus))
  const regItem = kyb.items.registration
  const regBadge = regItem ? ITEM_BADGE[regItem.state] : null

  return (
    <div className="space-y-6">
      {kyb.reviewerNote && (
        <div className={`${noteCls} ${kyb.status === 'rejected' ? 'bg-[#f2d4cd] text-[#8a2e1f]' : 'org-peach text-foreground'}`}>
          <span className="font-semibold">Note from our review: </span>
          <span className="whitespace-pre-line">{kyb.reviewerNote}</span>
        </div>
      )}

      <VerificationChecklist kyb={kyb} services={shown} showcase={!!kyb.services.showcase?.active} />

      <Block id="kyb-profile" title="Business details" item={kyb.items.profile} description="As registered with the government. Your documents are checked against these.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="kyb-legal-name"
            label="Legal name"
            value={details.legalName}
            onChange={v => setDetail('legalName', v)}
            error={errs.legalName}
            locked={locked.has('legalName')}
            hint="Exactly as on your PAN or registration."
            input={{ maxLength: 200, autoComplete: 'organization' }}
          />
          <TextField
            id="kyb-trade-name"
            label="Trade name"
            optional
            value={details.tradeName}
            onChange={v => setDetail('tradeName', v)}
            error={errs.tradeName}
            hint="The name customers know you by, if it is different."
            input={{ maxLength: 200 }}
          />
          <Field id="kyb-entity" label="Business type" error={errs.entityType} hint={locked.has('entityType') ? LOCKED : undefined}>
            <AdminSelect
              id="kyb-entity"
              value={details.entityType}
              disabled={locked.has('entityType')}
              placeholder="Pick the business type"
              options={ENTITY_TYPES.map(e => ({ value: e.id, label: e.label }))}
              onChange={setEntity}
            />
          </Field>
          <Field id="kyb-mobile" label="Mobile" optional error={errs.mobile} hint="For calls about your verification.">
            <PhoneInput id="kyb-mobile" value={details.mobile} onChange={v => setDetail('mobile', v)} inputClassName={`${fieldInput} min-w-0 flex-1`} />
          </Field>
          <TextField
            id="kyb-address"
            className="sm:col-span-2"
            label="Address"
            value={details.addressLine}
            onChange={v => setDetail('addressLine', v)}
            error={errs.addressLine}
            hint="Building, street and area, as on your registration."
            input={{ maxLength: 300, autoComplete: 'street-address' }}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField id="kyb-city" label="City" value={details.city} onChange={v => setDetail('city', v)} error={errs.city} input={{ maxLength: 100, autoComplete: 'address-level2' }} />
          <Field id="kyb-state" label="State" error={errs.state}>
            <AdminSelect
              id="kyb-state"
              value={details.state}
              placeholder="Pick the state"
              options={[...(details.state && !INDIAN_STATES.includes(details.state) ? [details.state] : []), ...INDIAN_STATES].map(s => ({ value: s, label: s }))}
              onChange={v => setDetail('state', v)}
            />
          </Field>
          <TextField
            id="kyb-pincode"
            label="PIN code"
            value={details.pincode}
            error={errs.pincode}
            input={{ inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 }}
            onChange={v => {
              const pin = v.replace(/\D/g, '').slice(0, 6)
              setDetail('pincode', pin)
              const st = pin.length === 6 ? stateFromPincode(pin) : null
              if (st && !details.state) setDetail('state', stateOption(st))
            }}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="kyb-signatory"
            label="Authorised signatory"
            value={details.authorizedName}
            onChange={v => setDetail('authorizedName', v)}
            error={errs.authorizedName}
            hint="The person who signs for the business. For a proprietorship, the proprietor."
            input={{ maxLength: 120, autoComplete: 'name' }}
          />
          <TextField
            id="kyb-designation"
            label="Designation"
            optional
            value={details.authorizedDesignation}
            onChange={v => setDetail('authorizedDesignation', v)}
            error={errs.authorizedDesignation}
            hint="Proprietor, partner, director…"
            input={{ maxLength: 80 }}
          />
        </div>
        <SaveRow dirty={changedDetails.length > 0} busy={saving === 'details'} onSave={saveDetails} />
      </Block>

      <Block id="kyb-pan" title="PAN" item={kyb.items.pan} description="The business’s Permanent Account Number. A sole proprietorship uses the proprietor’s own PAN.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="kyb-pan-number"
            label="PAN"
            value={panValue}
            locked={panLocked}
            error={panError}
            hint={
              savedEntity && draftEntity && savedEntity !== draftEntity
                ? 'You changed the business type above. Save the business details first: the PAN is checked against the saved type.'
                : panCheck.ok
                  ? `Issued to ${PAN_HOLDERS[panValue[3]]}.`
                  : 'Like ABCDE1234F.'
            }
            input={{ autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, maxLength: 14, onBlur: () => setPanLeft(true) }}
            onChange={v => {
              setPan(idChars(v, 10))
              clear('pan')
            }}
          />
        </div>
        {!panLocked && <SaveRow dirty={panDirty} busy={saving === 'pan'} onSave={savePan} />}
        <div className="mt-5">
          <DocCard docType="pan_card" doc={docOf('pan_card')} blocked={nameBlock ?? (!p.pan ? 'Save your PAN above first: the card is checked against it.' : null)} {...docProps} />
        </div>
      </Block>

      <Block
        id="kyb-gst"
        title="GST registration"
        item={kyb.items.gst}
        description="A business registered for GST uploads its certificate. One that isn’t tells us why and uploads a registration proof instead."
      >
        <div>
          <p className={fieldLabel} id="kyb-gst-q">
            Is the business registered for GST?
          </p>
          <ChoiceChips
            ariaLabel="Is the business registered for GST?"
            size="md"
            value={gst.registered === null ? null : gst.registered ? 'yes' : 'no'}
            onChange={v => setG({ registered: v === 'yes' }, 'gstRegistered', 'gstin', 'gstExemptReason')}
            options={[
              { value: 'yes', label: 'Yes', disabled: registeredLocked },
              { value: 'no', label: 'No', disabled: registeredLocked },
            ]}
          />
          {registeredLocked && <p className="mt-1 text-xs text-foreground-muted">{LOCKED}</p>}
          {errs.gstRegistered && <p className={errCls}>{errs.gstRegistered}</p>}
        </div>

        {gst.registered === true && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                id="kyb-gstin"
                label="GSTIN"
                value={gstinValue}
                locked={gstinLocked}
                error={gstinError}
                hint={gstinValue && gstinCheck.ok ? `Registered in ${gstinParts(gstinValue).state}.` : 'The 15-character number on your GST certificate.'}
                input={{ autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, maxLength: 20, onBlur: () => setGstinLeft(true) }}
                onChange={v => setG({ gstin: idChars(v, 15) }, 'gstin')}
              />
            </div>
            {!(registeredLocked && gstinLocked) && <SaveRow dirty={gstDirty} busy={saving === 'gst'} onSave={saveGst} />}
            <div className="mt-5 space-y-3">
              <DocCard
                docType="gst_cert"
                doc={docOf('gst_cert')}
                blocked={nameBlock ?? (!(p.gstRegistered && p.gstin) ? 'Save your GSTIN above first: the certificate is checked against it.' : null)}
                {...docProps}
              />
              {regCards.length > 0 && (
                <>
                  <p className="pt-2 text-sm text-foreground-secondary">You don’t need a registration proof with GST. Remove this one, or leave it for the reviewer.</p>
                  {regCards}
                </>
              )}
            </div>
          </>
        )}

        {gst.registered === false && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="kyb-gst-reason" label="Why isn’t it registered?" error={errs.gstExemptReason}>
                <AdminSelect id="kyb-gst-reason" value={gst.reason} placeholder="Pick a reason" options={GST_REASONS} onChange={v => setG({ reason: v }, 'gstExemptReason')} />
              </Field>
              <Field id="kyb-gst-note" label="Anything to add" optional error={errs.gstExemptNote} className="sm:col-span-2">
                <textarea
                  id="kyb-gst-note"
                  rows={2}
                  maxLength={500}
                  className={fieldInput}
                  value={gst.note}
                  onChange={e => setG({ note: e.target.value }, 'gstExemptNote')}
                  {...described('kyb-gst-note', errs.gstExemptNote)}
                />
              </Field>
            </div>
            <SaveRow dirty={gstDirty} busy={saving === 'gst'} onSave={saveGst} />

            <div id="kyb-registration" className="mt-6 scroll-mt-24 border-t border-border-default/60 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Registration proof</h3>
                {regBadge && <Badge tone={regBadge.tone}>{regBadge.label}</Badge>}
              </div>
              <p className="mt-1 text-sm text-foreground-secondary">
                Without GST, the business shows it exists with one of these.
                {!savedEntity && ' Save your business type above to see the ones that suit it.'}
              </p>
              {regItem?.problem && (regItem.state === 'invalid' || regItem.state === 'rejected') && <p className="mt-1 text-sm text-[#8a2e1f]">{regItem.problem}</p>}
              <div className="mt-4 space-y-3">
                {regCards}
                {!regUsed && (
                  <>
                    {regOptions.length > 1 && (
                      <ChoiceCards
                        ariaLabel="Registration proof"
                        columns="grid-cols-1 sm:grid-cols-2"
                        value={regChoice}
                        onChange={setRegPick}
                        options={regOptions.map(o => ({ value: o, label: KYB_DOCS[o].label, description: KYB_DOCS[o].hint }))}
                      />
                    )}
                    {regChoice && <DocCard key={regChoice} docType={regChoice} blocked={nameBlock} {...docProps} />}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Block>

      <Block id="kyb-website" title="Website" item={kyb.items.website} description="Where your business presents itself online. Carriers and WhatsApp look at it before they allow business messages.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="kyb-website-url"
            label="Website or business page"
            value={website}
            error={errs.website}
            hint="A social media page works too, if it shows the business."
            input={{ type: 'url', inputMode: 'url', autoComplete: 'url', placeholder: 'https://yourbusiness.in', maxLength: 255 }}
            onChange={v => {
              setWebsite(v)
              clear('website')
            }}
          />
        </div>
        {suggested && !website.trim() && (
          <button
            type="button"
            className="mt-2 text-sm font-semibold ecom-accent-text hover:underline"
            onClick={() => {
              setWebsite(suggested)
              clear('website')
            }}
          >
            Use your store, {suggested.replace('https://', '')}
          </button>
        )}
        <SaveRow dirty={websiteDirty} busy={saving === 'website'} onSave={saveWebsite} />
      </Block>

      <Block id="kyb-messaging" title="How you will message people" item={kyb.items.messaging_use} description="What you will send and to whom. Carriers and Meta ask Jeffi for this before your messages go out.">
        <div className="space-y-5">
          <div>
            <p className={fieldLabel}>What you will send</p>
            <ChoiceChips<string>
              multiple
              ariaLabel="What you will send"
              size="md"
              value={usage.purposes}
              onChange={v => setU('purposes', v)}
              options={MESSAGING_PURPOSES.map(o => ({ value: o.id, label: o.label }))}
            />
            {errs['messagingUse.purposes'] && <p className={errCls}>{errs['messagingUse.purposes']}</p>}
          </div>
          <div>
            <p className={fieldLabel}>Messages a month</p>
            <ChoiceChips<string>
              ariaLabel="Messages a month"
              size="md"
              value={usage.volume || null}
              onChange={v => setU('volume', v)}
              options={MESSAGING_VOLUMES.map(o => ({ value: o.id, label: o.label }))}
            />
            {errs['messagingUse.volume'] && <p className={errCls}>{errs['messagingUse.volume']}</p>}
          </div>
          <Field id="kyb-optin" label="How people agree to hear from you" error={errs['messagingUse.optIn']} hint="For example: customers tick a box at checkout to get order updates on WhatsApp.">
            <textarea
              id="kyb-optin"
              rows={3}
              maxLength={1000}
              className={fieldInput}
              value={usage.optIn}
              onChange={e => setU('optIn', e.target.value)}
              {...described('kyb-optin', errs['messagingUse.optIn'], true)}
            />
          </Field>
          <Field id="kyb-sample" label="One message you will send" error={errs['messagingUse.sample']} hint="Write it as people will see it.">
            <textarea
              id="kyb-sample"
              rows={3}
              maxLength={1000}
              className={fieldInput}
              value={usage.sample}
              placeholder="Hi Priya, your order #1042 has shipped and arrives by Friday. Track it here: …"
              onChange={e => setU('sample', e.target.value)}
              {...described('kyb-sample', errs['messagingUse.sample'], true)}
            />
          </Field>
          <div className="rounded-xl bg-surface-secondary p-4">
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={usage.accept} onChange={e => setU('accept', e.target.checked)} aria-describedby="kyb-policy" />
              <span>
                <span className="font-semibold">I accept Jeffi’s messaging policy.</span>
                {savedUsage.accept && p.messagingUse?.acceptedAt && (
                  <span className="text-foreground-muted">
                    {' '}
                    Accepted on {new Date(p.messagingUse.acceptedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}.
                  </span>
                )}
              </span>
            </label>
            <ul id="kyb-policy" className="ml-7 mt-2 list-disc space-y-1 pl-4 text-xs text-foreground-secondary">
              {POLICY.map(t => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {errs['messagingUse.accept'] && <p className={`${errCls} ml-7`}>{errs['messagingUse.accept']}</p>}
          </div>
        </div>
        <SaveRow dirty={usageDirty} busy={saving === 'messaging'} onSave={saveUsage} error={errs.messagingUse} />
      </Block>
    </div>
  )
}
