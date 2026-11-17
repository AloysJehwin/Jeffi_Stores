import { emptyShowcaseContent, type ShowcaseBusiness, type ShowcaseContent, type SocialNetwork } from '@/lib/showcase/types'
import { SHOWCASE_SOCIALS } from '@/lib/showcase/clean'
import { SHOWCASE_SLUG_RE } from '@/lib/showcase/host'
import type { ClientSite } from '@controller/lib/showcase-builder/site'

// The Showcase builder's form (the signup's Details step and the dashboard editor): what the owner types, kept as typed
// while they edit. The server cleans it on every save (lib/showcase/clean.ts), so the form never takes the cleaned
// copy back: half-filled rows stay on screen until they are complete.

export interface BusinessForm {
  name: string
  profession: string
  tagline: string
  about: string
  logo: string
  /** E.164, as the phone input gives it. */
  phone: string
  whatsapp: string
  whatsappSame: boolean
  email: string
  address: string
  city: string
  state: string
  pincode: string
  hours: string
  /** As typed: a handle or a link. */
  socials: Record<SocialNetwork, string>
}

export interface DetailsForm {
  slug: string
  business: BusinessForm
  content: ShowcaseContent
}

const digits = (s: string) => s.replace(/\D/g, '')

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

export function formFromSite(site: ClientSite | null, ownerEmail = ''): DetailsForm {
  const b: Partial<ShowcaseBusiness> = site?.business ?? {}
  const phone = b.phone ? (b.phone.trim().startsWith('+') ? `+${digits(b.phone)}` : digits(b.phone).length === 10 ? `+91${digits(b.phone)}` : b.phone) : ''
  const whatsapp = b.whatsapp ? `+${digits(b.whatsapp)}` : ''
  return {
    slug: site?.slug ?? '',
    business: {
      name: b.name ?? '',
      profession: b.profession ?? '',
      tagline: b.tagline ?? '',
      about: b.about ?? '',
      logo: b.logo ?? '',
      phone,
      whatsapp,
      whatsappSame: !site || (!!phone && digits(phone) === digits(whatsapp)),
      email: b.email ?? (site ? '' : ownerEmail),
      address: b.address ?? '',
      city: b.city ?? '',
      state: b.state ?? '',
      pincode: b.pincode ?? '',
      hours: b.hours ?? '',
      socials: Object.fromEntries(SHOWCASE_SOCIALS.map(n => [n, b.socials?.[n] ?? ''])) as Record<SocialNetwork, string>,
    },
    content: { ...emptyShowcaseContent(), ...(site?.content ?? {}) },
  }
}

/** What a save sends: the form as typed (the server cleans it). */
export function businessFromForm(f: BusinessForm): Record<string, unknown> {
  return {
    name: f.name,
    profession: f.profession,
    tagline: f.tagline,
    about: f.about,
    logo: f.logo || null,
    phone: f.phone,
    whatsapp: f.whatsappSame ? f.phone : f.whatsapp,
    email: f.email,
    address: f.address,
    city: f.city,
    state: f.state,
    pincode: f.pincode,
    hours: f.hours,
    socials: f.socials,
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** One way to reach the business, typed well enough to keep. */
export function hasContact(f: BusinessForm): boolean {
  const whatsapp = f.whatsappSame ? f.phone : f.whatsapp
  return digits(f.phone).length >= 10 || digits(whatsapp).length >= 10 || EMAIL.test(f.email.trim())
}

/** What stops the Details step, or null: a name, a free address and one way to reach the business. */
export function detailsProblem(form: DetailsForm, slugOk: boolean): string | null {
  if (form.business.name.trim().length < 2) return 'Give your business a name.'
  if (!SHOWCASE_SLUG_RE.test(form.slug)) return 'Choose your site address.'
  if (!slugOk) return 'Choose an address nobody has taken.'
  if (!hasContact(form.business)) return 'Add a phone number, a WhatsApp number or an email, so people can reach you.'
  if (form.business.email.trim() && !EMAIL.test(form.business.email.trim())) return 'Check your email address.'
  if (form.business.pincode && form.business.pincode.length !== 6) return 'A PIN code has 6 digits.'
  return null
}

/** Enough to create the draft: a name and an address in the right shape. */
export const canSave = (form: DetailsForm) => form.business.name.trim().length >= 2 && SHOWCASE_SLUG_RE.test(form.slug)
