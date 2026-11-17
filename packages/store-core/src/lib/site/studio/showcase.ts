import { isPageKey, type PageKey } from '@jeffi/site-blocks'
import { SHOWCASE_PAGE_KEY } from '../../showcase/types'
import { askJson, newSeed, orNull, str } from './ai'
import { cleanAnswers, readRefs } from './brief'
import type { StudioAnswers, StudioBrief } from './types'
import { uiStyle } from './ui-styles'

// The studio for a Showcase (lib/showcase): a business's one-page site. Same steps as a store's (brief, plan,
// directions, build), worded for a business and its clients; the plan is plan.ts planShowcase and the section rules
// prompts.ts showcaseSystem. The brief's `kind` tells the shared prompts which site they are writing.

const TIERS = ['value', 'mid', 'premium', 'luxury'] as const

/** The site page a session's page key is laid out as: `store:home` → home, a Showcase's one page → showcase. */
export function studioPageOf(key: string): PageKey | null {
  if (key === SHOWCASE_PAGE_KEY) return 'showcase'
  const page = key.split(':')[1] ?? key
  return isPageKey(page) && page !== 'showcase' ? page : null
}

/** The brief for a Showcase: the Details step's business (name, what they do, about) plus the studio's answers. */
export async function showcaseBrief(input: StudioAnswers | Record<string, unknown>): Promise<StudioBrief> {
  const a = cleanAnswers(input)
  const references = await readRefs(a.references ?? [])
  const out = await askJson(
    `You write the creative brief for the one-page website of an Indian business or professional (a photographer, a clinic, a tutor, a salon, an architect, a caterer…). It shows their work, proof and reviews and gets them enquiries; it sells nothing online. Read the owner's answers and return JSON:
{"storeName": the business's name (keep theirs), "summary": one sentence on the business, "category": what they do in a few words, "vocabulary": [8-12 specific words their clients use, e.g. "candid, pre-wedding, haldi" rather than "quality services"], "audience": who their clients are and why they come, "priceTier": "value"|"mid"|"premium"|"luxury", "voice": the copy voice in a few words, "mood": the visual mood in a few words, "artDirection": one sentence on the look of every picture (light, setting, colours)}.
Be specific to this business; never generic.`,
    `Business name: ${a.storeName || '(not given)'}
${a.tagline ? `Their tagline: ${a.tagline}\n` : ''}${a.about ? `About the business, in their words: ${a.about}\n` : ''}What they do: ${a.sell || '(not given)'}
Their clients: ${a.audience || '(not given)'}
Mood: ${a.mood || '(not given)'}
${uiStyle(a.uiStyle) ? `Design style they picked: ${uiStyle(a.uiStyle)!.rules}\n` : ''}${a.notes ? `Notes: ${a.notes}\n` : ''}${references.length ? `Sites they like (their feel only, never their words):\n${references.map(r => `- ${r.url}: ${r.feel} Density ${r.density}${r.imageLed ? ', image-led' : ''}. Sections: ${r.patterns.slice(0, 10).join(', ')}`).join('\n')}` : ''}`,
    { maxTokens: 1200, temperature: 0.6 }
  ).catch(orNull)
  const vocab = Array.isArray(out?.vocabulary) ? out.vocabulary : typeof out?.vocabulary === 'string' ? out.vocabulary.split(',') : []
  return {
    storeName: str(a.storeName, 80) || str(out?.storeName, 80, 'Our business'),
    summary: str(out?.summary, 300, a.about?.slice(0, 300) || a.sell.slice(0, 300) || 'A local business.'),
    category: str(out?.category, 120, a.sell.slice(0, 120)),
    vocabulary: vocab.map(v => String(v).trim()).filter(Boolean).slice(0, 12),
    audience: str(out?.audience, 240, a.audience ?? ''),
    priceTier: TIERS.includes(out?.priceTier as never) ? (out!.priceTier as StudioBrief['priceTier']) : 'mid',
    voice: str(out?.voice, 120, 'warm and clear'),
    mood: str(out?.mood, 160, a.mood ?? ''),
    artDirection: str(out?.artDirection, 300, 'Natural light, real settings, true-to-life colour'),
    references,
    uiStyle: a.uiStyle ?? null,
    logoUrl: a.logoUrl ?? null,
    tagline: a.tagline,
    about: a.about,
    contact: a.contact,
    socials: a.socials,
    seed: newSeed(),
    kind: 'showcase',
  }
}

const QUESTIONS: Record<string, string> = {
  sell: 'what the business does (its work and services)',
  audience: 'who their clients are and why they come to them',
  mood: 'the mood and look the site should have',
  notes: 'anything else that makes the business special',
}

/** "Help me answer" for a Showcase's brief. */
export async function suggestShowcaseAnswer(question: string, so: StudioAnswers | Record<string, unknown>): Promise<string> {
  const { contact: _contact, socials: _socials, ...a } = cleanAnswers(so)
  const out = await askJson<{ answer?: unknown }>(
    `You help an Indian business owner describe their business for its one-page website. Suggest a short answer (1-2 sentences, their voice, no emoji) to the question about ${QUESTIONS[question] ?? question}. Return JSON {"answer": "..."}.`,
    `What they have said so far: ${JSON.stringify(a)}`,
    { maxTokens: 300, temperature: 0.9, modelHint: 'copy' }
  )
  return str(out?.answer, 400)
}
