'use client'

import { fieldInput, fieldLabel } from '../onboard/ui'
import type { DomainContact } from './types'

/** The registrant contact for a domain. Route 53 keeps it private (WHOIS privacy) and the registry emails it to confirm. */
export default function ContactFields({ value, onChange }: { value: DomainContact; onChange: (c: DomainContact) => void }) {
  const set = (patch: Partial<DomainContact>) => onChange({ ...value, ...patch })
  const field = (key: keyof DomainContact, label: string, opts: { placeholder?: string; type?: string; optional?: boolean; className?: string } = {}) => (
    <div className={opts.className}>
      <label className={fieldLabel}>
        {label}
        {opts.optional && <span className="font-normal text-foreground-muted"> (optional)</span>}
      </label>
      <input
        aria-label={label}
        className={fieldInput}
        type={opts.type ?? 'text'}
        value={(value[key] as string | undefined) ?? ''}
        placeholder={opts.placeholder}
        onChange={e => set({ [key]: e.target.value } as Partial<DomainContact>)}
      />
    </div>
  )
  const pill = (t: DomainContact['contactType'], label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value.contactType === t}
      onClick={() => set({ contactType: t })}
      className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${value.contactType === t ? 'ecom-accent-bg border-transparent' : 'border-border-default text-foreground-secondary hover:text-foreground'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Registered to" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground-secondary mr-1">Registered to</span>
        {pill('PERSON', 'Me')}
        {pill('COMPANY', 'My business')}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field('firstName', 'First name')}
        {field('lastName', 'Last name')}
        {value.contactType === 'COMPANY' && field('organizationName', 'Business name', { className: 'sm:col-span-2' })}
        {field('email', 'Email', { type: 'email' })}
        {field('phoneNumber', 'Phone', { placeholder: '+91.9876543210', type: 'tel' })}
        {field('addressLine1', 'Address', { className: 'sm:col-span-2' })}
        {field('addressLine2', 'Address line 2', { optional: true, className: 'sm:col-span-2' })}
        {field('city', 'City')}
        {field('state', 'State')}
        {field('zipCode', 'PIN code')}
        <div>
          <label className={fieldLabel}>Country</label>
          <input className={`${fieldInput} opacity-70`} value="India" readOnly aria-readonly />
        </div>
      </div>
    </div>
  )
}
