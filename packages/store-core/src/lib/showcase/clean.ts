import { socialUrl, whatsappDigits } from '@/lib/catalog/store-socials'
import type { ShowcaseBusiness, ShowcaseContent, ShowcaseFaq, ShowcasePagePicture, ShowcaseReview, ShowcaseService, ShowcaseStat, ShowcaseWork, SocialNetwork } from './types'

// What an owner types into a Showcase (the signup's Details step, the dashboard editor), trimmed, capped and checked:
// links and pictures must be https (pictures are the owner's uploads), socials become profile URLs, WhatsApp digits
// with the country code. Pure, so the forms and the routes read the same rules.

export const SHOWCASE_LIMITS = { services: 24, work: 30, reviews: 20, stats: 8, faqs: 20, pictures: 6 } as const
export const SHOWCASE_SOCIALS: SocialNetwork[] = ['instagram', 'facebook', 'youtube', 'x', 'linkedin', 'pinterest']

const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const list = (v: unknown) => (Array.isArray(v) ? v : [])
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
/** Multi-line text (about, descriptions, answers): line breaks kept, runs of blank lines folded. */
const para = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '')
const https = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s<>"'`\\]*)?$/i.test(s) && s.length <= 2000 ? s : ''
}
const opt = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as T
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A profile link from a handle or URL, or '' when it is neither. */
export const showcaseSocialUrl = (network: SocialNetwork, input: unknown) => socialUrl(network, input) || ''

export function cleanBusiness(input: unknown): ShowcaseBusiness {
  const b = rec(input)
  const socials: Partial<Record<SocialNetwork, string>> = {}
  const s = rec(b.socials)
  for (const n of SHOWCASE_SOCIALS) {
    const url = showcaseSocialUrl(n, s[n])
    if (url) socials[n] = url
  }
  const phone = text(b.phone, 20)
  const email = text(b.email, 200).toLowerCase()
  const pincode = text(b.pincode, 6)
  return {
    name: text(b.name, 120),
    ...opt({
      tagline: text(b.tagline, 160),
      profession: text(b.profession, 120),
      about: para(b.about, 2000),
      logo: https(b.logo) || null,
      phone: phone.replace(/\D/g, '').length >= 8 ? phone : '',
      whatsapp: whatsappDigits(b.whatsapp) || '',
      email: EMAIL.test(email) ? email : '',
      address: text(b.address, 300),
      city: text(b.city, 80),
      state: text(b.state, 80),
      pincode: /^\d{6}$/.test(pincode) ? pincode : '',
      hours: text(b.hours, 160),
      socials: Object.keys(socials).length ? socials : undefined,
      mapUrl: https(b.mapUrl),
    }),
  }
}

// The AI's suggestions keep their mark until the owner edits them (the editor drops it).
const ai = (x: Record<string, unknown>) => (x.ai === true ? { ai: true as const } : {})

export function cleanContent(input: unknown): ShowcaseContent {
  const c = rec(input)
  const services: ShowcaseService[] = list(c.services)
    .map(rec)
    .map(x => opt({ title: text(x.title, 120), description: para(x.description, 600), price: text(x.price, 60), image: https(x.image) || null, ...ai(x) }))
    .filter(x => x.title)
    .slice(0, SHOWCASE_LIMITS.services)
  const work: ShowcaseWork[] = list(c.work)
    .map(rec)
    .map(x => opt({ title: text(x.title, 120), description: para(x.description, 600), image: https(x.image), link: https(x.link) }) as ShowcaseWork)
    .filter(x => x.image)
    .slice(0, SHOWCASE_LIMITS.work)
  const reviews: ShowcaseReview[] = list(c.reviews)
    .map(rec)
    .map(x => {
      const rating = Math.round(Number(x.rating))
      return opt({ name: text(x.name, 80), quote: para(x.quote, 800), rating: rating >= 1 && rating <= 5 ? rating : undefined, source: text(x.source, 60), avatar: https(x.avatar) || null })
    })
    .filter(x => x.name && x.quote)
    .slice(0, SHOWCASE_LIMITS.reviews)
  const stats: ShowcaseStat[] = list(c.stats)
    .map(rec)
    .map(x => ({ value: text(x.value, 30), label: text(x.label, 80) }))
    .filter(x => x.value && x.label)
    .slice(0, SHOWCASE_LIMITS.stats)
  const faqs: ShowcaseFaq[] = list(c.faqs)
    .map(rec)
    .map(x => ({ q: text(x.q ?? x.question, 200), a: para(x.a ?? x.answer, 1500), ...ai(x) }))
    .filter(x => x.q && x.a)
    .slice(0, SHOWCASE_LIMITS.faqs)
  const pictures: ShowcasePagePicture[] = list(c.pictures)
    .map(rec)
    .map(x => opt({ image: https(x.image), alt: text(x.alt, 120), ...ai(x) }) as ShowcasePagePicture)
    .filter(x => x.image)
    .slice(0, SHOWCASE_LIMITS.pictures)
  return { services, work, reviews, stats, faqs, ...(pictures.length ? { pictures } : {}) }
}

/** The ways a visitor can reach the business (a Showcase needs one). */
export const contactChannels = (b: ShowcaseBusiness) => [b.phone, b.whatsapp, b.email].filter(Boolean).length

/** What stops the Details step: a name and one contact channel. The address is checked on its own. */
export function businessIssues(b: ShowcaseBusiness): string[] {
  const issues: string[] = []
  if ((b.name ?? '').length < 2) issues.push('Give your business a name.')
  if (!contactChannels(b)) issues.push('Add a phone number, a WhatsApp number or an email, so people can reach you.')
  return issues
}
