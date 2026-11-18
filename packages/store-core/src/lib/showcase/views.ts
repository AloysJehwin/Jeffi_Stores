import { stars } from '../site/data/format'
import type { ShowcaseBusiness, ShowcaseContent, SocialNetwork } from './types'

// What the Showcase parts bind (lib/site/code/parts/showcase.tsx): the business and its content as flat, render-ready
// views. Every link is built here (tel:, mailto:, wa.me, a map search), so a page never types contact details.

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
}

export interface BusinessView {
  name: string
  tagline: string
  profession: string
  about: string
  logo: string | null
  /** The name's first letter, for a mark when there is no logo. */
  initial: string
  phone: string
  phoneUrl: string
  whatsapp: string
  whatsappUrl: string
  email: string
  emailUrl: string
  address: string
  city: string
  state: string
  pincode: string
  /** "City, State". */
  location: string
  /** The address, city, state and PIN on one line. */
  fullAddress: string
  hours: string
  mapUrl: string
  socials: { network: SocialNetwork; href: string; label: string }[]
  year: number
}

export interface ServiceView {
  title: string
  description: string
  price: string
  image: string | null
  /** "01", "02"… */
  number: string
}

export interface WorkView {
  title: string
  description: string
  image: string
  link: string
  number: string
}

export interface TestimonialView {
  name: string
  quote: string
  rating: number | null
  stars: string
  source: string
  avatar: string | null
  initial: string
}

export interface StatView {
  value: string
  label: string
}

export interface FaqView {
  question: string
  answer: string
}

const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const https = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s<>"'`\\]+$/i.test(v.trim()) ? v.trim() : '')
const image = (v: unknown) => https(v) || (typeof v === 'string' && /^\/(?![/\\])[^\s<>"'`\\]*$/.test(v.trim()) ? v.trim() : '')
const num = (i: number) => String(i + 1).padStart(2, '0')
// encodeURIComponent leaves ' ( ) * ! alone; links with them are refused by the renderer.
const enc = (s: string) => encodeURIComponent(s).replace(/['()*!]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** A tel: link: a 10-digit Indian number gets +91, anything else keeps its own digits and leading +. */
export function phoneHref(phone: string): string {
  const raw = phone.trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 6 || digits.length > 15) return ''
  if (raw.startsWith('+')) return `tel:+${digits}`
  if (digits.length === 10) return `tel:+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `tel:+91${digits.slice(1)}`
  return `tel:${digits}`
}

export const whatsappHref = (digits: string) => (/^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}` : '')

export const emailHref = (email: string) => (/^[^\s@/<>"'`]+@[^\s@/<>"'`]+\.[^\s@/<>"'`]+$/.test(email) ? `mailto:${email}` : '')

export function businessView(b: ShowcaseBusiness): BusinessView {
  const name = text(b.name, 120) || 'Our business'
  const city = text(b.city, 80)
  const state = text(b.state, 80)
  const pincode = text(b.pincode, 10)
  const address = text(b.address, 300)
  const location = [city, state].filter(Boolean).join(', ')
  const fullAddress = [address, city, [state, pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const phone = text(b.phone, 30)
  const whatsapp = text(b.whatsapp, 20).replace(/\D/g, '')
  const email = text(b.email, 200)
  const socials = (Object.keys(SOCIAL_NETWORK_LABELS) as SocialNetwork[])
    .map(network => ({ network, href: https(b.socials?.[network]), label: SOCIAL_NETWORK_LABELS[network] }))
    .filter(s => s.href)
  return {
    name,
    tagline: text(b.tagline, 200),
    profession: text(b.profession, 120),
    about: text(b.about, 2000),
    logo: image(b.logo) || null,
    initial: name.charAt(0).toUpperCase(),
    phone,
    phoneUrl: phone ? phoneHref(phone) : '',
    whatsapp,
    whatsappUrl: whatsappHref(whatsapp),
    email,
    emailUrl: email ? emailHref(email) : '',
    address,
    city,
    state,
    pincode,
    location,
    fullAddress,
    hours: text(b.hours, 200),
    mapUrl: https(b.mapUrl) || (fullAddress ? `https://www.google.com/maps/search/?api=1&query=${enc(`${name}, ${fullAddress}`)}` : ''),
    socials,
    year: new Date().getFullYear(),
  }
}

export const serviceViews = (c: ShowcaseContent): ServiceView[] =>
  (c.services ?? [])
    .filter(s => text(s?.title))
    .map((s, i) => ({ title: text(s.title, 120), description: text(s.description, 600), price: text(s.price, 60), image: image(s.image) || null, number: num(i) }))

export const workViews = (c: ShowcaseContent): WorkView[] =>
  (c.work ?? [])
    .filter(w => image(w?.image))
    .map((w, i) => ({ title: text(w.title, 120), description: text(w.description, 600), image: image(w.image), link: https(w.link), number: num(i) }))

export const testimonialViews = (c: ShowcaseContent, minRating = 1): TestimonialView[] =>
  (c.reviews ?? [])
    .filter(r => text(r?.name) && text(r?.quote))
    .map(r => {
      const rating = typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5 ? Math.round(r.rating) : null
      const name = text(r.name, 80)
      return { name, quote: text(r.quote, 800), rating, stars: rating ? stars(rating) : '', source: text(r.source, 60), avatar: image(r.avatar) || null, initial: name.charAt(0).toUpperCase() }
    })
    .filter(r => r.rating == null || r.rating >= minRating)

export const statViews = (c: ShowcaseContent): StatView[] =>
  (c.stats ?? []).filter(s => text(s?.label) && text(s?.value)).map(s => ({ value: text(s.value, 30), label: text(s.label, 80) }))

export const faqViews = (c: ShowcaseContent): FaqView[] =>
  (c.faqs ?? []).filter(f => text(f?.q) && text(f?.a)).map(f => ({ question: text(f.q, 200), answer: text(f.a, 1500) }))
