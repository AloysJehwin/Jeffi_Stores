'use client'

import { Check, Loader2 } from 'lucide-react'
import { PhoneInput } from '../../../_ui/phone'
import { Card } from '../../../dashboard/_components/Card'
import { fieldInput, fieldLabel } from '../../ui'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { SHOWCASE_SOCIALS, showcaseSocialUrl } from '@/lib/showcase/clean'
import { SOCIAL_NETWORK_LABELS } from '@/lib/showcase/views'
import { SHOWCASE_HOST_PREFIX, type SocialNetwork } from '@/lib/showcase/types'
import ImageField from './ImageField'
import { hasContact, slugify, type BusinessForm, type DetailsForm } from './model'
import type { SlugState } from './useShowcaseDetails'

// The business: name and site address, what it does, its story and logo; how people reach it; its social profiles.
// The same fields as the store wizard's Store step (onboarding StoreStep), for a business rather than a shop.

const inp = fieldInput
const lbl = fieldLabel
const optional = <span className="font-normal text-foreground-muted">(optional)</span>
const errCls = 'mt-1 text-xs text-[#8a2e1f]'
const ROOT = 'jeffistores.in'

const SOCIAL_HINT: Record<SocialNetwork, string> = {
  instagram: '@yourbusiness or instagram.com/yourbusiness',
  facebook: 'facebook.com/yourbusiness',
  youtube: '@yourbusiness or a channel link',
  x: '@yourbusiness',
  linkedin: 'linkedin.com/company/yourbusiness',
  pinterest: 'pinterest.com/yourbusiness',
}

export default function BusinessFields({
  form,
  setForm,
  slug,
  slugLocked = false,
  slugTouched,
  onSlugTouched,
}: {
  form: DetailsForm
  setForm: (f: (f: DetailsForm) => DetailsForm) => void
  slug: SlugState
  /** A published site keeps its address. */
  slugLocked?: boolean
  slugTouched: boolean
  onSlugTouched: () => void
}) {
  const b = form.business
  const set = (patch: Partial<BusinessForm>) => setForm(f => ({ ...f, business: { ...f.business, ...patch } }))
  const reachable = hasContact(b)

  return (
    <div className="space-y-4">
      <Card title="Your business">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label htmlFor="sc-name" className={lbl}>
                Business name
              </label>
              <input
                id="sc-name"
                className={inp}
                maxLength={120}
                autoComplete="organization"
                placeholder="e.g. Lens & Light Studio"
                value={b.name}
                onChange={e => {
                  const name = e.target.value
                  setForm(f => ({ ...f, business: { ...f.business, name }, ...(slugLocked || slugTouched ? {} : { slug: slugify(name) }) }))
                }}
              />
            </div>
            <div>
              <label htmlFor="sc-slug" className={lbl}>
                Site address
              </label>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 font-mono text-sm text-foreground-muted">{SHOWCASE_HOST_PREFIX}</span>
                <input
                  id="sc-slug"
                  className={`${inp} min-w-0 font-mono ${slugLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                  value={form.slug}
                  readOnly={slugLocked}
                  autoCapitalize="none"
                  // Browsers otherwise fill this with the street address.
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={58}
                  aria-describedby="sc-slug-state"
                  onChange={e => {
                    onSlugTouched()
                    setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 58) }))
                  }}
                />
                <span className="shrink-0 font-mono text-sm text-foreground-muted">.{ROOT}</span>
              </div>
              <p id="sc-slug-state" className="mt-1 min-h-[1rem] text-xs" aria-live="polite">
                {slugLocked ? (
                  <span className="text-foreground-muted">Your site lives here; a published address can&apos;t change.</span>
                ) : slug.state === 'checking' ? (
                  <span className="inline-flex items-center gap-1 text-foreground-muted">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                  </span>
                ) : slug.state === 'ok' && form.slug ? (
                  <span className="inline-flex items-center gap-1 org-sage-text">
                    <Check className="h-3 w-3" strokeWidth={3} /> {SHOWCASE_HOST_PREFIX}
                    {form.slug}.{ROOT} is yours
                  </span>
                ) : slug.state === 'taken' ? (
                  <span className="text-[#8a2e1f]">{slug.error}</span>
                ) : (
                  <span className="text-foreground-muted">Lowercase letters, numbers and hyphens.</span>
                )}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="sc-profession" className={lbl}>
              What you do {optional}
            </label>
            <input id="sc-profession" className={inp} maxLength={120} placeholder="e.g. Wedding photographer in Chennai" value={b.profession} onChange={e => set({ profession: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[9rem_1fr]">
            <div>
              <span className={lbl}>Logo {optional}</span>
              <ImageField value={b.logo} onChange={url => set({ logo: url ?? '' })} kind="logo" label="Upload your logo" className="h-28 w-full sm:w-36" fit="contain" />
              <p className="mt-1 text-[11px] text-foreground-muted">PNG, JPG or WebP.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="sc-tagline" className={lbl}>
                  Tagline {optional}
                </label>
                <input id="sc-tagline" className={inp} maxLength={160} placeholder="e.g. Candid stories of your big day" value={b.tagline} onChange={e => set({ tagline: e.target.value })} />
              </div>
              <div>
                <label htmlFor="sc-about" className={lbl}>
                  About {optional}
                </label>
                <textarea
                  id="sc-about"
                  className={`${inp} h-28 resize-y`}
                  maxLength={2000}
                  placeholder="A few lines on who you are, how you work and what makes you different."
                  value={b.about}
                  onChange={e => set({ about: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="How people reach you">
        <p className={`-mt-2 mb-4 text-xs ${reachable ? 'text-foreground-muted' : 'text-[#8a2e1f]'}`}>
          At least one of phone, WhatsApp or email. Your site shows them, and its enquiry form sends you leads.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="sc-phone" className={lbl}>
                Phone
              </label>
              <PhoneInput id="sc-phone" value={b.phone} onChange={v => set({ phone: v })} inputClassName={`${inp} min-w-0 flex-1`} />
            </div>
            <div>
              <label htmlFor="sc-whatsapp" className={lbl}>
                WhatsApp
              </label>
              {b.whatsappSame ? (
                <div className="flex min-h-11 items-center rounded-xl border border-border-default bg-surface-secondary px-3.5 text-sm text-foreground-secondary">{b.phone || 'Same as the phone number'}</div>
              ) : (
                <PhoneInput id="sc-whatsapp" value={b.whatsapp} onChange={v => set({ whatsapp: v })} inputClassName={`${inp} min-w-0 flex-1`} />
              )}
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-foreground-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-accent-600"
                  checked={b.whatsappSame}
                  onChange={e => set({ whatsappSame: e.target.checked, ...(e.target.checked ? {} : { whatsapp: b.whatsapp || b.phone }) })}
                />
                Same as phone
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="sc-email" className={lbl}>
                Email
              </label>
              <input id="sc-email" type="email" autoComplete="email" className={inp} maxLength={200} value={b.email} onChange={e => set({ email: e.target.value.trim() })} />
            </div>
            <div>
              <label htmlFor="sc-hours" className={lbl}>
                Hours {optional}
              </label>
              <input id="sc-hours" className={inp} maxLength={160} placeholder="e.g. Mon–Sat, 10 am – 7 pm" value={b.hours} onChange={e => set({ hours: e.target.value })} />
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label htmlFor="sc-address" className={lbl}>
                Address {optional}
              </label>
              <input id="sc-address" className={inp} maxLength={300} autoComplete="street-address" placeholder="Building, street and area" value={b.address} onChange={e => set({ address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="sc-city" className={lbl}>
                  City
                </label>
                <input id="sc-city" className={inp} maxLength={80} autoComplete="address-level2" value={b.city} onChange={e => set({ city: e.target.value })} />
              </div>
              <div>
                <label htmlFor="sc-state" className={lbl}>
                  State
                </label>
                <input id="sc-state" className={inp} maxLength={80} autoComplete="address-level1" value={b.state} onChange={e => set({ state: e.target.value })} />
              </div>
              <div>
                <label htmlFor="sc-pin" className={lbl}>
                  PIN code
                </label>
                <input
                  id="sc-pin"
                  className={inp}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="postal-code"
                  value={b.pincode}
                  onChange={e => {
                    const pincode = e.target.value.replace(/\D/g, '').slice(0, 6)
                    const state = !b.state && pincode.length === 6 ? stateFromPincode(pincode) : null
                    set({ pincode, ...(state ? { state } : {}) })
                  }}
                />
                {b.pincode && b.pincode.length !== 6 && <p className={errCls}>6 digits</p>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Social links">
        <p className="-mt-2 mb-4 text-xs text-foreground-muted">All optional. Paste a profile link or type the handle; your site links to each one you add.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SHOWCASE_SOCIALS.map(n => {
            const raw = b.socials[n] ?? ''
            const url = raw.trim() ? showcaseSocialUrl(n, raw) : ''
            return (
              <div key={n}>
                <label htmlFor={`sc-social-${n}`} className={lbl}>
                  {SOCIAL_NETWORK_LABELS[n]}
                </label>
                <input
                  id={`sc-social-${n}`}
                  className={inp}
                  inputMode="url"
                  autoCapitalize="none"
                  maxLength={300}
                  placeholder={SOCIAL_HINT[n]}
                  value={raw}
                  onChange={e => set({ socials: { ...b.socials, [n]: e.target.value } })}
                />
                {raw.trim() && !url ? (
                  <p className={errCls}>That doesn&apos;t look like a {SOCIAL_NETWORK_LABELS[n]} profile.</p>
                ) : url && url !== raw.trim() ? (
                  <p className="mt-1 truncate text-[11px] text-foreground-muted">{url}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
