import { isPageKey, type PageKey } from '@jeffi/site-blocks'
import { pictureFor, searchTerms } from '@/lib/ai/stock'
import { SHOWCASE_PAGE_KEY, type ShowcaseBusiness, type ShowcaseFaq, type ShowcasePagePicture, type ShowcaseService } from '../../showcase/types'
import { cleanStarter, reachText } from '../../showcase/starter'
import { askJson, newSeed, orNull, str, studioBudgetLeft } from './ai'
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
{"storeName": the business's name (keep theirs), "summary": one sentence on the business, "category": what they do in a few words, "vocabulary": [8-12 specific words their clients use, e.g. "candid, pre-wedding, haldi" rather than "quality services"], "audience": who their clients are and why they come, "priceTier": "value"|"mid"|"premium"|"luxury", "voice": the copy voice in a few words, "mood": the visual mood in a few words, "artDirection": one sentence on the look of every picture (light, setting, colours), "stockQueries": [3 stock-photo searches of 2-4 plain words, in order: the kind of place this business works in, a close detail of its craft (tools, materials), the setting where its clients enjoy the result; places and objects only, never people or brand names, e.g. "bakery counter", "flour dough", "cafe table"]}.
Be specific to this business; never generic.`,
    `Business name: ${a.storeName || '(not given)'}
${a.tagline ? `Their tagline: ${a.tagline}\n` : ''}${a.about ? `About the business, in their words: ${a.about}\n` : ''}What they do: ${a.sell || '(not given)'}
Their clients: ${a.audience || '(not given)'}
Mood: ${a.mood || '(not given)'}
${uiStyle(a.uiStyle) ? `Design style they picked: ${uiStyle(a.uiStyle)!.rules}\n` : ''}${a.notes ? `Notes: ${a.notes}\n` : ''}${references.length ? `Sites they like (their feel only, never their words):\n${references.map(r => `- ${r.url}: ${r.feel} Density ${r.density}${r.imageLed ? ', image-led' : ''}. Sections: ${r.patterns.slice(0, 10).join(', ')}`).join('\n')}` : ''}`,
    { maxTokens: 1200, temperature: 0.6 }
  ).catch(orNull)
  const vocab = Array.isArray(out?.vocabulary) ? out.vocabulary : typeof out?.vocabulary === 'string' ? out.vocabulary.split(',') : []
  const stockQueries = (Array.isArray(out?.stockQueries) ? out.stockQueries : []).map(q => searchTerms(String(q ?? ''))).filter(Boolean).slice(0, SCENES.length)
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
    ...(stockQueries.length ? { stockQueries } : {}),
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

/**
 * Starter services (or menu highlights) and questions for a business that gave none, written from its brief on the
 * copy model; lib/showcase/starter.ts keeps only what states no fact the owner did not give. Empty when the budget is
 * spent or the answer is unusable.
 */
export async function showcaseStarter(b: StudioBrief, business: ShowcaseBusiness): Promise<{ services: ShowcaseService[]; faqs: ShowcaseFaq[] }> {
  if (studioBudgetLeft() <= 0) return { services: [], faqs: [] }
  const out = await askJson(
    `You suggest starter content for the one-page website of an Indian business whose owner has given little detail; the owner checks and edits it before it matters. Return JSON {"services": [3-6 {"title": 2-5 plain words, "description": one short sentence on what it is}], "faqs": [2-4 {"q": a question their clients often ask, "a": a short answer}]}.
Services are what a business of this kind usually offers (for a café, menu highlights such as coffee or fresh bakes; for a photographer, the kinds of shoots), named plainly.
Never state a fact you were not given: no price, number, duration, year, opening hours, days, address, area, brand, ingredient origin, award, certification, guarantee, delivery, offer or claim of being the best. When an answer depends on such a fact (prices, timings, availability, bookings, delivery), say how to ask instead: ${reachText(business)}.
No quotes, reviews or client names. Indian English, no emoji.`,
    `Business: ${b.storeName}. ${b.summary}
What they do: ${b.category}. Clients: ${b.audience || 'not given'}. Words their clients use: ${b.vocabulary.join(', ') || 'none given'}. Voice: ${b.voice}.${b.about ? `\nIn their words: ${b.about.slice(0, 600)}` : ''}`,
    { maxTokens: 1500, temperature: 0.5, modelHint: 'copy' }
  ).catch(orNull)
  return cleanStarter(out)
}

// Mood pictures: the place, the craft and the setting of a business of this kind, never its work, people or brands.
const SCENES = ['the place and its atmosphere, wide', 'a close detail of the craft: tools, materials and textures', 'the setting where clients enjoy the result, calm and inviting']
/** Searches when the brief has none, per scene. */
const SCENE_SEARCH = ['interior', 'tools', 'table']

/**
 * Up to `max` mood pictures for a Showcase's page (BusinessPicture shows them after the owner's own work photos and
 * never as their work): a stock photo (credited) when one is found, else one made at draft quality while the budget
 * lasts. After the first generation failure the rest are stock only, and it says why.
 */
export async function showcasePictures(b: StudioBrief, max: number): Promise<{ pictures: ShowcasePagePicture[]; error?: string }> {
  const pictures: ShowcasePagePicture[] = []
  const used = new Set<string>()
  const category = searchTerms(b.category || 'local business', 3)
  let error: string | undefined
  for (const [i, scene] of SCENES.slice(0, Math.max(0, max)).entries()) {
    try {
      const p = await pictureFor({
        stock: { queries: [b.stockQueries?.[i] || `${category} ${SCENE_SEARCH[i]}`], shape: 'square', seed: b.seed, used, skipGallery: true },
        ai: error
          ? null
          : {
              prompt: `A mood photograph for the website of a ${b.category || 'local business'} in India: ${scene}. ${b.mood ? `Mood: ${b.mood}. ` : ''}${b.artDirection}. No people's faces, no text, no logos, no brand names, no watermarks.`,
              negativePrompt: 'text, letters, watermark, logo, brand, faces, people, distorted hands',
              width: 1024,
              height: 1024,
              feature: 'homepage_image',
              // Site generation always uses the cheapest image model.
              quality: 'draft',
              ref: 'site-studio:showcase-mood',
              skipGallery: true,
            },
        aiAllowed: () => studioBudgetLeft() > 0,
      })
      if (p?.credit) pictures.push({ image: p.url, ...(p.alt ? { alt: p.alt.slice(0, 120) } : {}), credit: p.credit })
      else if (p) pictures.push({ image: p.url, ai: true })
    } catch (err) {
      error = (err as Error)?.message?.slice(0, 400) || 'image generation failed'
    }
  }
  return error ? { pictures, error } : { pictures }
}
