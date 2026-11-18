import { readReferenceProfile } from '../reference'
import { cleanSocials, whatsappDigits } from '@/lib/catalog/store-socials'
import { askJson, newSeed, orNull, str, studioBudgetLeft } from './ai'
import type { BriefReference, StudioAnswers, StudioBrief, StudioContact } from './types'
import { uiStyle } from './ui-styles'

// The brief: the owner's answers read into what the store is, who it is for, its voice and vocabulary, plus the
// patterns and feel of the sites they like (lib/site/reference.ts; style cues only, nothing copied).

const TIERS = ['value', 'mid', 'premium', 'luxury'] as const

/** The Store step's contacts, each kept only when usable. */
function cleanContact(v: unknown): StudioContact | undefined {
  const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const t = (k: string, max: number) => (typeof c[k] === 'string' ? (c[k] as string).trim().slice(0, max) : '')
  const out: StudioContact = {}
  const phone = t('phone', 20)
  if (/^\+?\d{8,15}$/.test(phone.replace(/[\s-]/g, ''))) out.phone = phone
  const whatsapp = whatsappDigits(c.whatsapp)
  if (whatsapp) out.whatsapp = whatsapp
  const email = t('email', 200)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email
  const address = t('address', 500)
  if (address) out.address = address
  return Object.keys(out).length ? out : undefined
}

/** Answers from any client shape (aliases accepted), trimmed and capped. */
export function cleanAnswers(a: StudioAnswers | Record<string, unknown>): StudioAnswers {
  const r = a as Record<string, unknown>
  const s = (...keys: string[]) => keys.map(k => r[k]).find(v => typeof v === 'string' && v.trim()) as string | undefined
  const refs = (Array.isArray(r.references) ? r.references : Array.isArray(r.sites) ? r.sites : []).map(String).filter(u => /^https:\/\//i.test(u)).slice(0, 3)
  const socials = cleanSocials(r.socials)
  return {
    storeName: s('storeName', 'name', 'brand')?.trim().slice(0, 80),
    sell: (s('sell', 'what', 'description', 'products') ?? '').trim().slice(0, 1200),
    audience: s('audience', 'who', 'customers')?.trim().slice(0, 400),
    mood: s('mood', 'feel', 'style', 'vibe')?.trim().slice(0, 400),
    references: refs,
    logoUrl: s('logoUrl', 'logo') && /^https:\/\//i.test(s('logoUrl', 'logo')!) ? s('logoUrl', 'logo')! : null,
    uiStyle: uiStyle(r.uiStyle)?.id ?? null,
    notes: s('notes', 'extra', 'other')?.trim().slice(0, 800),
    tagline: s('tagline')?.trim().slice(0, 120),
    about: s('about')?.trim().slice(0, 600),
    contact: cleanContact(r.contact),
    socials: Object.keys(socials).length ? socials : undefined,
  }
}

export async function readRefs(urls: string[]): Promise<BriefReference[]> {
  if (!urls.length || studioBudgetLeft() <= 0) return []
  const profiles = await Promise.all(urls.map(u => readReferenceProfile(u).catch(() => null)))
  return profiles
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(p => ({ url: p.url, feel: p.feel, patterns: p.sequence.map(x => (x.note ? `${x.pattern} (${x.note})` : x.pattern)), density: p.density, imageLed: p.imageLed, colors: p.colors, fonts: p.fonts, uppercaseLabels: p.uppercaseLabels }))
}

export async function brief(input: StudioAnswers | Record<string, unknown>): Promise<StudioBrief> {
  const a = cleanAnswers(input)
  const references = await readRefs(a.references ?? [])
  const out = await askJson(
    `You write the creative brief for a new Indian online store's website. Read the owner's answers and return JSON:
{"storeName": the store's name (keep theirs; invent a short fitting one only if none is given), "summary": one sentence on the store, "category": what it sells in a few words, "vocabulary": [8-12 specific words its shoppers use, e.g. "Kanjivaram, zari, organza" rather than "premium products"], "audience": who buys and why, "priceTier": "value"|"mid"|"premium"|"luxury", "voice": the copy voice in a few words, "mood": the visual mood in a few words, "artDirection": one sentence on photography for every picture (light, setting, props, colours)}.
Be specific to this store; never generic.`,
    `Store name: ${a.storeName || '(not given)'}
${a.tagline ? `Their tagline: ${a.tagline}\n` : ''}${a.about ? `About the store, in their words: ${a.about}\n` : ''}What they sell: ${a.sell || '(not given)'}
Who for: ${a.audience || '(not given)'}
Mood: ${a.mood || '(not given)'}
${uiStyle(a.uiStyle) ? `Design style they picked: ${uiStyle(a.uiStyle)!.rules}\n` : ''}${a.notes ? `Notes: ${a.notes}\n` : ''}${references.length ? `Sites they like (their feel only, never their words):\n${references.map(r => `- ${r.url}: ${r.feel} Density ${r.density}${r.imageLed ? ', image-led' : ''}. Sections: ${r.patterns.slice(0, 10).join(', ')}`).join('\n')}` : ''}`,
    { maxTokens: 1200, temperature: 0.6 }
  ).catch(orNull)
  const vocab = Array.isArray(out?.vocabulary) ? out.vocabulary : typeof out?.vocabulary === 'string' ? out.vocabulary.split(',') : []
  return {
    storeName: str(a.storeName, 80) || str(out?.storeName, 80, 'Our store'),
    summary: str(out?.summary, 300, a.sell.slice(0, 300) || 'An online store.'),
    category: str(out?.category, 120, a.sell.slice(0, 120)),
    vocabulary: vocab.map(v => String(v).trim()).filter(Boolean).slice(0, 12),
    audience: str(out?.audience, 240, a.audience ?? ''),
    priceTier: TIERS.includes(out?.priceTier as never) ? (out!.priceTier as StudioBrief['priceTier']) : 'mid',
    voice: str(out?.voice, 120, 'warm and clear'),
    mood: str(out?.mood, 160, a.mood ?? ''),
    artDirection: str(out?.artDirection, 300, 'Natural light, clean backgrounds, true-to-life colour'),
    references,
    uiStyle: a.uiStyle ?? null,
    logoUrl: a.logoUrl ?? null,
    tagline: a.tagline,
    about: a.about,
    contact: a.contact,
    socials: a.socials,
    seed: newSeed(),
  }
}

const QUESTIONS: Record<string, string> = {
  sell: 'what the store sells (product types, materials, range)',
  audience: 'who the customers are and why they buy',
  mood: 'the mood and look the site should have',
  notes: 'anything else that makes the store special',
}

/** "Help me answer": a suggested answer to one question from what the owner has said so far. */
export async function suggestAnswer(question: keyof typeof QUESTIONS | string, so: StudioAnswers | Record<string, unknown>): Promise<string> {
  // Their contacts don't help word an answer.
  const { contact: _contact, socials: _socials, ...a } = cleanAnswers(so)
  const out = await askJson<{ answer?: unknown }>(
    `You help an Indian shop owner describe their new online store. Suggest a short answer (1-2 sentences, their voice, no emoji) to the question about ${QUESTIONS[question] ?? question}. Return JSON {"answer": "..."}.`,
    `What they have said so far: ${JSON.stringify(a)}`,
    { maxTokens: 300, temperature: 0.9, modelHint: 'copy' }
  )
  return str(out?.answer, 400)
}
