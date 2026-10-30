import { aiChat, type AiChatRequest, type AiChatResponse } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { COUNTS, LIMITS, adTextLength, clipAtWord, cleanAdText, enforceTexts } from './limits'

// "Write with AI" for ad copy. The model is asked for Google's limits, and every line is checked
// again here: cleaned, clipped at a word when that still reads, or dropped.

export const COPY_KINDS = ['rsa', 'pmax', 'sitelinks', 'callouts'] as const
export type CopyKind = (typeof COPY_KINDS)[number]

export interface CopyContext {
  productNames?: string[]
  category?: string | null
  brand?: string | null
  keywords?: string[]
  finalUrl?: string | null
  /** Free text from the admin: offer, angle, audience. */
  notes?: string | null
  links?: { name: string; url: string }[]
  /** Store facts worth mentioning (free delivery threshold, COD). */
  facts?: string[]
}

export type CopyResult =
  | { kind: 'rsa'; headlines: string[]; descriptions: string[]; dropped: number }
  | { kind: 'pmax'; headlines: string[]; longHeadlines: string[]; descriptions: string[]; dropped: number }
  | { kind: 'sitelinks'; sitelinks: { linkText: string; description1: string; description2: string }[]; dropped: number }
  | { kind: 'callouts'; callouts: string[]; dropped: number }

const SHAPES: Record<CopyKind, string> = {
  rsa: `{"headlines":["..."],"descriptions":["..."]}
- headlines: 12 different headlines, each at most ${LIMITS.headline} characters
- descriptions: 4 different descriptions, each at most ${LIMITS.description} characters`,
  pmax: `{"headlines":["..."],"longHeadlines":["..."],"descriptions":["..."]}
- headlines: 10 different headlines, each at most ${LIMITS.headline} characters (some under 15)
- longHeadlines: 5, each at most ${LIMITS.longHeadline} characters
- descriptions: 5, each at most ${LIMITS.description} characters; at least two at most ${LIMITS.shortDescription}`,
  sitelinks: `{"sitelinks":[{"linkText":"...","description1":"...","description2":"..."}]}
- one entry per link given, in the same order
- linkText at most ${LIMITS.sitelinkText} characters; description1 and description2 at most ${LIMITS.sitelinkDescription} each`,
  callouts: `{"callouts":["..."]}
- 8 callouts, each at most ${LIMITS.callout} characters, short facts about the store (no full sentences)`,
}

function systemPrompt(kind: CopyKind, store: string): string {
  return `You write Google Ads copy for ${store}, for shoppers in India, in English.
Return ONLY valid JSON in this shape:
${SHAPES[kind]}

RULES:
- Count characters, including spaces. Never exceed a limit; shorter is fine.
- No exclamation marks in headlines or callouts. No emojis. No words in ALL CAPS.
- Only use prices, discounts, delivery or return terms that are given to you. Never invent claims, awards or ratings.
- Vary the angle: product, benefit, range, trust (delivery, payment), call to action.
- Do not repeat the same line with small changes.`
}

function userPrompt(ctx: CopyContext): string {
  const lines = [
    ctx.category ? `Category: ${ctx.category}` : null,
    ctx.brand ? `Brand: ${ctx.brand}` : null,
    ctx.productNames?.length ? `Products: ${ctx.productNames.slice(0, 12).join('; ')}` : null,
    ctx.keywords?.length ? `Keywords: ${ctx.keywords.slice(0, 15).join(', ')}` : null,
    ctx.finalUrl ? `Landing page: ${ctx.finalUrl}` : null,
    ctx.facts?.length ? `Store facts: ${ctx.facts.join('; ')}` : null,
    ctx.links?.length ? `Links:\n${ctx.links.slice(0, 10).map(l => `- ${l.name} (${l.url})`).join('\n')}` : null,
    ctx.notes ? `Notes from the store: ${ctx.notes.slice(0, 500)}` : null,
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : 'Write general ads for the store.'
}

/** Make sure Performance Max gets a description short enough for its short slot. */
export function ensureShortDescription(list: string[]): string[] {
  if (!list.length || list.some(d => adTextLength(d) <= LIMITS.shortDescription)) return list
  const shortest = [...list].sort((a, b) => adTextLength(a) - adTextLength(b))[0]
  const short = clipAtWord(shortest, LIMITS.shortDescription, 0.4)
  return short ? [...list.slice(0, COUNTS.pmaxDescriptions[1] - 1), short] : list
}

/** Enforce Google's limits on whatever the model returned. Exported for tests and re-use. */
export function enforceCopy(kind: CopyKind, raw: Record<string, any> | null, linkCount = 0): CopyResult {
  const r = raw ?? {}
  if (kind === 'rsa') {
    const h = enforceTexts(r.headlines, LIMITS.headline, { headline: true, maxItems: COUNTS.rsaHeadlines[1] })
    const d = enforceTexts(r.descriptions, LIMITS.description, { maxItems: COUNTS.rsaDescriptions[1] })
    return { kind, headlines: h.kept, descriptions: d.kept, dropped: h.dropped + d.dropped }
  }
  if (kind === 'pmax') {
    const h = enforceTexts(r.headlines, LIMITS.headline, { headline: true, maxItems: COUNTS.pmaxHeadlines[1] })
    const l = enforceTexts(r.longHeadlines, LIMITS.longHeadline, { maxItems: COUNTS.pmaxLongHeadlines[1] })
    const d = enforceTexts(r.descriptions, LIMITS.description, { maxItems: COUNTS.pmaxDescriptions[1] })
    return { kind, headlines: h.kept, longHeadlines: l.kept, descriptions: ensureShortDescription(d.kept), dropped: h.dropped + l.dropped + d.dropped }
  }
  if (kind === 'sitelinks') {
    let dropped = 0
    const list = (Array.isArray(r.sitelinks) ? r.sitelinks : []).slice(0, Math.max(1, linkCount || 20)).map((s: any) => {
      const text = enforceTexts([s?.linkText], LIMITS.sitelinkText, { headline: true }).kept[0] ?? ''
      const d = enforceTexts([s?.description1, s?.description2], LIMITS.sitelinkDescription).kept
      if (!text) dropped++
      // Both description lines or neither.
      return { linkText: text, description1: d.length === 2 ? d[0] : '', description2: d.length === 2 ? d[1] : '' }
    })
    return { kind, sitelinks: list, dropped }
  }
  const c = enforceTexts(r.callouts, LIMITS.callout, { headline: true, maxItems: 20 })
  return { kind: 'callouts', callouts: c.kept, dropped: c.dropped }
}

export async function writeAdCopy(
  kind: CopyKind,
  ctx: CopyContext,
  ai: (req: AiChatRequest) => Promise<AiChatResponse> = aiChat
): Promise<CopyResult> {
  const { storeDescriptorForPrompt } = await import('@/lib/catalog/brand')
  const res = await ai({
    modelHint: 'copy',
    jsonMode: true,
    temperature: 0.7,
    maxTokens: 900,
    messages: [
      { role: 'system', content: systemPrompt(kind, await storeDescriptorForPrompt()) },
      { role: 'user', content: userPrompt({ ...ctx, notes: ctx.notes ? cleanAdText(ctx.notes) : null }) },
    ],
  })
  const parsed = parseAiJson<Record<string, any>>(String(res.content ?? '').trim())
  if (!parsed) throw new Error('The AI reply could not be read. Try again.')
  return enforceCopy(kind, parsed, ctx.links?.length ?? 0)
}
