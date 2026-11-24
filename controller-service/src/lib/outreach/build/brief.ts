import { createHash } from 'crypto'
import { cleanBusiness } from '@/lib/showcase/clean'
import type { ShowcaseBusiness } from '@/lib/showcase/types'

// The progressive brief a call fills in, kept on the contact (outreach_contacts.extra.brief) so a language-switch
// redial or a WhatsApp follow-up carries it over. Pure: merging, what is still missing, and what the sketch and the
// studio take from it.

export interface OutreachBrief {
  whatTheyDo?: string
  audience?: string
  highlights?: string[]
  contact?: { phone?: string; email?: string; whatsapp?: string }
  hours?: string
  address?: string
  style?: string
  /** The language the site's words are written in (English when unset). */
  language?: string
}

/** What is stored: the brief plus change requests made before the full design (folded into the next build). */
export type StoredBrief = OutreachBrief & { changes?: string[] }

/** The order the caller asks in. `language` is never asked for. */
export const ASK_ORDER = ['whatTheyDo', 'audience', 'highlights', 'contact', 'hours', 'address', 'style'] as const satisfies readonly (keyof OutreachBrief)[]

const MAX = { whatTheyDo: 600, audience: 400, hours: 160, address: 300, style: 200, language: 20, highlight: 160, change: 300 }
const HIGHLIGHTS = 8
const CHANGES = 5

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function union(a: unknown, b: unknown, max: number, cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : typeof b === 'string' ? [b] : [])]) {
    const s = text(v, max)
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase())
      out.push(s)
    }
  }
  return out.slice(-cap)
}

/** The stored brief as read from the contact's extra (anything malformed dropped). */
export function readBrief(extra: unknown): StoredBrief {
  return mergeBriefs({}, rec(rec(extra).brief) as StoredBrief)
}

/** `partial` onto `base`: a non-empty value replaces, highlights and changes accumulate, contact merges per channel. */
export function mergeBriefs(base: StoredBrief, partial: Partial<StoredBrief>): StoredBrief {
  const p = rec(partial)
  const out: StoredBrief = {}
  for (const k of ['whatTheyDo', 'audience', 'hours', 'address', 'style', 'language'] as const) {
    const v = text(p[k], MAX[k]) || text(base[k], MAX[k])
    if (v) out[k] = v
  }
  const highlights = union(base.highlights, p.highlights, MAX.highlight, HIGHLIGHTS)
  if (highlights.length) out.highlights = highlights
  const contact: NonNullable<OutreachBrief['contact']> = {}
  const bc = rec(base.contact)
  const pc = rec(p.contact)
  for (const k of ['phone', 'email', 'whatsapp'] as const) {
    const v = text(pc[k], 200) || text(bc[k], 200)
    if (v) contact[k] = k === 'email' ? v.toLowerCase() : v
  }
  if (Object.keys(contact).length) out.contact = contact
  const changes = union(base.changes, p.changes, MAX.change, CHANGES)
  if (changes.length) out.changes = changes
  return out
}

export function missingOf(b: OutreachBrief): (keyof OutreachBrief)[] {
  return ASK_ORDER.filter(k => (k === 'highlights' ? !b.highlights?.length : k === 'contact' ? !Object.keys(b.contact ?? {}).length : !b[k]))
}

/** Enough for the full design: what they do, and who it's for or what stands out. */
export const readyToBuild = (b: OutreachBrief) => !!b.whatTheyDo && (!!b.audience || !!b.highlights?.length)

/** What the design depends on; details shown live (contact, hours, address) don't count, so they never rebuild. */
export const briefHash = (b: StoredBrief) =>
  createHash('sha256')
    .update(JSON.stringify([b.whatTheyDo ?? '', b.audience ?? '', b.highlights ?? [], b.style ?? '', b.language ?? '', b.changes ?? []]))
    .digest('hex')
    .slice(0, 16)

const LANGUAGE_NAMES: Record<string, string> = { hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi' }

/** The site's language by name, null for English. Accepts a code or a name. */
export function siteLanguage(b: OutreachBrief): string | null {
  const l = (b.language ?? '').trim().toLowerCase()
  if (!l || l === 'en' || l.startsWith('english')) return null
  return LANGUAGE_NAMES[l.slice(0, 2)] ?? Object.values(LANGUAGE_NAMES).find(n => n.toLowerCase() === l) ?? null
}

/** The studio's answers from the brief (merged over what the Details already give). */
export function studioAnswersOf(b: StoredBrief): Record<string, unknown> {
  const lang = siteLanguage(b)
  const notes = [
    b.highlights?.length ? `What stands out, in the owner's words: ${b.highlights.join('; ')}.` : '',
    b.changes?.length ? `The owner asked for: ${b.changes.join('; ')}.` : '',
    lang ? `Write every word on the page in ${lang}.` : '',
  ].filter(Boolean)
  return {
    ...(b.whatTheyDo ? { sell: b.whatTheyDo } : {}),
    ...(b.audience ? { audience: b.audience } : {}),
    ...(b.style ? { mood: b.style } : {}),
    ...(notes.length ? { notes: notes.join(' ').slice(0, 800) } : {}),
  }
}

/** One line from what they do, cut at a word: the sketch's tagline. */
function firstLine(s: string, max: number): string {
  const one = s.split(/(?<=[.!?])\s/)[0] ?? s
  if (one.length <= max) return one.replace(/[.!?]+$/, '')
  return `${one.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

/** The site's details with the brief's on top (cleaned as the Details step cleans them). The name stays. */
export function businessWith(current: ShowcaseBusiness, b: OutreachBrief): ShowcaseBusiness {
  const c = b.contact ?? {}
  return cleanBusiness({
    ...current,
    ...(b.whatTheyDo ? { tagline: firstLine(b.whatTheyDo, 120), about: b.whatTheyDo, ...(current.profession ? {} : { profession: firstLine(b.whatTheyDo, 60) }) } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.email ? { email: c.email } : {}),
    ...(c.whatsapp ? { whatsapp: c.whatsapp } : {}),
    ...(b.hours ? { hours: b.hours } : {}),
    ...(b.address ? { address: b.address } : {}),
  })
}
