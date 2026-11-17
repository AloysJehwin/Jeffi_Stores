import { STORE_SOCIAL_LABELS, STORE_SOCIAL_NETWORKS, cleanSocials, socialUrl, whatsappDigits, type StoreSocialNetwork } from '@/lib/catalog/store-socials'
import { isValidPhone } from '../_ui/phone'

// The Store step's site details: what the generated site shows (tagline, story, contacts, social links). The draft
// keeps them as typed; submit sends them cleaned.

export interface StoreContact {
  phone: string
  whatsapp: string
  /** WhatsApp on the store phone. */
  whatsappSame: boolean
  email: string
  address: string
  city: string
  state: string
  pincode: string
}

export interface StoreDetails {
  tagline: string
  about: string
  contact: StoreContact
  /** As typed: a handle or a link. */
  socials: Partial<Record<StoreSocialNetwork, string>>
}

export const TAGLINE_MAX = 120
export const ABOUT_MAX = 600
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** From a draft; the email starts as the owner's sign-in email. */
export function initialStoreDetails(init: Record<string, any>, ownerEmail: string): StoreDetails {
  const c = (init.contact && typeof init.contact === 'object' ? init.contact : {}) as Record<string, unknown>
  const s = (init.socials && typeof init.socials === 'object' ? init.socials : {}) as Record<string, unknown>
  return {
    tagline: str(init.tagline),
    about: str(init.about),
    contact: {
      phone: str(c.phone),
      whatsapp: str(c.whatsapp),
      whatsappSame: typeof c.whatsappSame === 'boolean' ? c.whatsappSame : true,
      email: typeof c.email === 'string' ? c.email : ownerEmail,
      address: str(c.address),
      city: str(c.city),
      state: str(c.state),
      pincode: str(c.pincode),
    },
    socials: Object.fromEntries(STORE_SOCIAL_NETWORKS.map(n => [n, str(s[n])]).filter(([, v]) => v)),
  }
}

export const whatsappOf = (c: StoreContact) => (c.whatsappSame ? c.phone : c.whatsapp)

/** The first thing to fix, in the order the step shows them; null when the details are complete. */
export function storeDetailsProblem(d: StoreDetails): string | null {
  const c = d.contact
  if (!c.phone) return 'Add a phone number customers can call.'
  if (!isValidPhone(c.phone)) return 'Check the store phone number.'
  const wa = whatsappOf(c)
  if (wa && (!isValidPhone(wa) || whatsappDigits(wa) === null)) return 'Check the WhatsApp number.'
  if (!c.email.trim()) return 'Add an email customers can write to.'
  if (!EMAIL.test(c.email.trim())) return 'Check the store email.'
  if (c.pincode && !/^\d{6}$/.test(c.pincode)) return 'The PIN code must be 6 digits.'
  for (const n of STORE_SOCIAL_NETWORKS) if (socialUrl(n, d.socials[n]) === null) return `Check the ${STORE_SOCIAL_LABELS[n]} link or handle.`
  return null
}

/** What submit sends: trimmed, WhatsApp resolved, socials as links. */
export function storeDetailsPayload(d: StoreDetails) {
  const c = d.contact
  const t = (v: string) => v.trim() || undefined
  return {
    tagline: t(d.tagline.slice(0, TAGLINE_MAX)),
    about: t(d.about.slice(0, ABOUT_MAX)),
    contact: {
      phone: t(c.phone),
      whatsapp: t(whatsappOf(c)),
      email: t(c.email),
      address: t(c.address),
      city: t(c.city),
      state: t(c.state),
      pincode: t(c.pincode),
    },
    socials: cleanSocials(d.socials),
  }
}
