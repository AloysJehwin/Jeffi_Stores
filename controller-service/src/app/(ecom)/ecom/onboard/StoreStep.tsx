'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { ChoiceChips } from '../_ui'
import { PhoneInput } from '../_ui/phone'
import { Card } from '../dashboard/_components/Card'
import DomainSearch from '../_domains/DomainSearch'
import CompliancePanel from './CompliancePanel'
import { fieldInput, fieldLabel, ghostBtn } from './ui'
import { ABOUT_MAX, TAGLINE_MAX, type StoreContact, type StoreDetails } from './store-details'
import { SELLING_CATEGORIES, type ComplianceState } from '@controller/lib/catalog/compliance'
import { STORE_SOCIAL_LABELS, STORE_SOCIAL_NETWORKS, socialUrl, type StoreSocialNetwork } from '@/lib/catalog/store-socials'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'

// The Store step: everything the generated site needs about the store (name, address, logo, tagline and story,
// contacts, social links), what it sells and the licences that needs, and an optional own domain.

const inp = fieldInput
const lbl = fieldLabel
const optional = <span className="text-foreground-muted font-normal">(optional)</span>
const errCls = 'text-xs text-[#8a2e1f] mt-1'

export interface DomainPick {
  name: string
  priceInr: number
  renewalPriceInr: number
}

const SOCIAL_HINT: Record<StoreSocialNetwork, string> = {
  instagram: '@yourstore or instagram.com/yourstore',
  facebook: 'facebook.com/yourstore',
  youtube: '@yourstore or a channel link',
  x: '@yourstore',
  linkedin: 'linkedin.com/company/yourstore',
  pinterest: 'pinterest.com/yourstore',
}

export default function StoreStep({
  upgrade,
  displayName,
  onDisplayName,
  slug,
  onSlug,
  categories,
  onCategories,
  logo,
  onLogo,
  details,
  onDetails,
  compliance,
  onCompliance,
  gst,
  onGst,
  domainPick,
  onDomainPick,
}: {
  /** A services workspace adding a store: its subdomain is already reserved. */
  upgrade: boolean
  displayName: string
  onDisplayName: (v: string) => void
  slug: string
  /** Raw input; the wizard slugifies it. */
  onSlug: (v: string) => void
  categories: string[]
  onCategories: (v: string[]) => void
  logo: { s3Key: string; url: string }
  onLogo: (l: { s3Key: string; url: string }) => void
  details: StoreDetails
  onDetails: Dispatch<SetStateAction<StoreDetails>>
  compliance: ComplianceState
  onCompliance: Dispatch<SetStateAction<ComplianceState>>
  gst: { s3Key: string; fileName: string }
  onGst: (s3Key: string, fileName: string) => void
  domainPick: DomainPick | null
  onDomainPick: (d: DomainPick | null) => void
}) {
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoErr, setLogoErr] = useState<string | null>(null)
  const c = details.contact
  const setContact = (patch: Partial<StoreContact>) => onDetails(d => ({ ...d, contact: { ...d.contact, ...patch } }))

  async function uploadLogo(file: File) {
    setLogoBusy(true)
    setLogoErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'logo')
      const res = await fetch('/api/ecom/onboard/brand-upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLogoErr(data.error || 'Upload failed')
        return
      }
      onLogo({ s3Key: data.s3Key, url: data.url })
    } catch {
      setLogoErr('Network error')
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Your store">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label htmlFor="store-name" className={lbl}>
                Store name
              </label>
              <input id="store-name" className={inp} value={displayName} maxLength={200} onChange={e => onDisplayName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="store-subdomain" className={lbl}>
                Subdomain
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="store-subdomain"
                  className={`${inp} min-w-0 ${upgrade ? 'opacity-70 cursor-not-allowed' : ''}`}
                  value={slug}
                  readOnly={upgrade}
                  onChange={e => onSlug(e.target.value)}
                />
                <span className="shrink-0 text-sm text-foreground-muted whitespace-nowrap font-mono">.jeffistores.in</span>
              </div>
              {upgrade && <p className="text-xs text-foreground-muted mt-1">Your workspace&apos;s subdomain — already reserved for your store.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[9rem_1fr]">
            <div>
              <span className={lbl}>Logo</span>
              <label className="ecom-focus flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface p-3 transition-colors hover:border-accent-500">
                {logo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo.url} alt="Store logo" className="max-h-16 object-contain" />
                ) : (
                  <span className="text-center text-xs text-foreground-muted">{logoBusy ? 'Uploading…' : 'Upload your logo'}</span>
                )}
                {logo.url && <span className="text-[11px] text-foreground-muted">{logoBusy ? 'Uploading…' : 'Change'}</span>}
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  className="sr-only"
                  aria-label="Upload your store logo"
                  disabled={logoBusy}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) uploadLogo(f)
                  }}
                />
              </label>
              {logoErr ? <p className={errCls}>{logoErr}</p> : <p className="mt-1 text-[11px] text-foreground-muted">PNG, JPG or WebP, up to 3 MB.</p>}
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="store-tagline" className={lbl}>
                  Tagline {optional}
                </label>
                <input
                  id="store-tagline"
                  className={inp}
                  maxLength={TAGLINE_MAX}
                  placeholder="e.g. Handwoven silk from Kanchipuram"
                  value={details.tagline}
                  onChange={e => onDetails(d => ({ ...d, tagline: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="store-about" className={lbl}>
                  About your store {optional}
                </label>
                <textarea
                  id="store-about"
                  className={`${inp} h-24 resize-none`}
                  maxLength={ABOUT_MAX}
                  placeholder="Two or three lines on who you are and what makes your products special."
                  value={details.about}
                  onChange={e => onDetails(d => ({ ...d, about: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="What you sell">
        <div className="space-y-5">
          <div>
            <span className={lbl}>
              Pick all that apply
            </span>
            <ChoiceChips
              multiple
              size="md"
              ariaLabel="Product categories"
              className="mt-2"
              value={categories}
              onChange={onCategories}
              options={SELLING_CATEGORIES.map(x => ({ value: x, label: x }))}
            />
            {categories.length === 0 && <p className="text-xs text-foreground-muted mt-2">Select at least one category.</p>}
          </div>
          <div className="border-t border-border-default pt-5">
            <CompliancePanel categories={categories} value={compliance} onChange={onCompliance} gst={gst} onGst={onGst} />
          </div>
        </div>
      </Card>

      <Card title="How customers reach you">
        <p className="-mt-2 mb-4 text-xs text-foreground-muted">Shown on your site. India&apos;s e-commerce rules ask stores to show a phone number and email for customer care.</p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="store-phone" className={lbl}>
                Phone
              </label>
              <PhoneInput id="store-phone" value={c.phone} onChange={v => setContact({ phone: v })} inputClassName={`${inp} min-w-0 flex-1`} />
            </div>
            <div>
              <label htmlFor="store-whatsapp" className={lbl}>
                WhatsApp {optional}
              </label>
              {c.whatsappSame ? (
                <div className="flex min-h-11 items-center rounded-xl border border-border-default bg-surface-secondary/60 px-3.5 text-sm text-foreground-secondary">
                  {c.phone || 'Same as the phone number'}
                </div>
              ) : (
                <PhoneInput id="store-whatsapp" value={c.whatsapp} onChange={v => setContact({ whatsapp: v })} inputClassName={`${inp} min-w-0 flex-1`} />
              )}
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-foreground-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-accent-600"
                  checked={c.whatsappSame}
                  onChange={e => setContact({ whatsappSame: e.target.checked, ...(e.target.checked ? {} : { whatsapp: c.whatsapp || c.phone }) })}
                />
                Same as phone
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="store-email" className={lbl}>
              Email
            </label>
            <input id="store-email" type="email" autoComplete="email" className={inp} maxLength={200} value={c.email} onChange={e => setContact({ email: e.target.value.trim() })} />
          </div>
          <div className="space-y-3">
            <div>
              <label htmlFor="store-address" className={lbl}>
                Address {optional}
              </label>
              <input
                id="store-address"
                className={inp}
                maxLength={300}
                autoComplete="street-address"
                placeholder="Shop number, street and area"
                value={c.address}
                onChange={e => setContact({ address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="store-city" className={lbl}>
                  City
                </label>
                <input id="store-city" className={inp} maxLength={80} autoComplete="address-level2" value={c.city} onChange={e => setContact({ city: e.target.value })} />
              </div>
              <div>
                <label htmlFor="store-state" className={lbl}>
                  State
                </label>
                <input id="store-state" className={inp} maxLength={80} autoComplete="address-level1" value={c.state} onChange={e => setContact({ state: e.target.value })} />
              </div>
              <div>
                <label htmlFor="store-pin" className={lbl}>
                  PIN code
                </label>
                <input
                  id="store-pin"
                  className={inp}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="postal-code"
                  value={c.pincode}
                  onChange={e => {
                    const pincode = e.target.value.replace(/\D/g, '').slice(0, 6)
                    // The state follows from most PIN codes; never overwrite one the owner typed.
                    setContact({ pincode, ...(!c.state && pincode.length === 6 && stateFromPincode(pincode) ? { state: stateFromPincode(pincode)! } : {}) })
                  }}
                />
                {c.pincode && c.pincode.length !== 6 && <p className={errCls}>6 digits</p>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Social links">
        <p className="-mt-2 mb-4 text-xs text-foreground-muted">All optional. Paste a profile link or type the handle; your site links to each one you add.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {STORE_SOCIAL_NETWORKS.map(n => {
            const raw = details.socials[n] ?? ''
            const url = socialUrl(n, raw)
            return (
              <div key={n}>
                <label htmlFor={`social-${n}`} className={lbl}>
                  {STORE_SOCIAL_LABELS[n]}
                </label>
                <input
                  id={`social-${n}`}
                  className={inp}
                  inputMode="url"
                  autoCapitalize="none"
                  maxLength={300}
                  placeholder={SOCIAL_HINT[n]}
                  value={raw}
                  onChange={e => onDetails(d => ({ ...d, socials: { ...d.socials, [n]: e.target.value } }))}
                />
                {url === null ? (
                  <p className={errCls}>That doesn&apos;t look like a {STORE_SOCIAL_LABELS[n]} profile.</p>
                ) : url && url !== raw.trim() ? (
                  <p className="mt-1 truncate text-[11px] text-foreground-muted">{url}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Your own domain">
        <p className="text-xs text-foreground-muted mb-3">
          Optional. Get a domain like yourbrand.in for your store. We buy it from your wallet once your store is approved, renew it yearly, and set it up for you.
        </p>
        {domainPick ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl org-sand px-4 py-3">
            <span className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">{domainPick.name}</span>
            <span className="text-sm text-foreground">₹{domainPick.priceInr.toLocaleString('en-IN')}/year</span>
            <button type="button" onClick={() => onDomainPick(null)} className={ghostBtn}>
              Remove
            </button>
          </div>
        ) : (
          <DomainSearch onPick={r => onDomainPick({ name: r.domain, priceInr: r.priceInr, renewalPriceInr: r.renewalPriceInr })} />
        )}
      </Card>
    </div>
  )
}
