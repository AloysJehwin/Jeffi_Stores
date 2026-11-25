import { pictureFor, searchTerms, type Picture, type StockShape } from '@/lib/ai/stock'
import { chat } from './ai'
import type { Language } from './languages'

// The visual editor's cheap element actions (docs/plans/SITE_EDITOR_PLAN.md phase 4): they return values, not code.
// Words rewritten, shortened or translated; a picture for an image slot's shape, a stock photo first (credited) and
// a generated one when none fits. The caller decides who pays (the store's AI wallet, a Showcase's daily help).

export const TEXT_ACTIONS = ['rewrite', 'shorten', 'translate'] as const
export type TextAction = (typeof TEXT_ACTIONS)[number]
export { LANGUAGES, type Language } from './languages'

const ASK: Record<TextAction, (language?: string) => string> = {
  rewrite: () => 'Rewrite it to read better: the same meaning, about the same length, in the same voice.',
  shorten: () => 'Make it shorter, about half as long or less, keeping what matters.',
  translate: l => `Translate it into ${l ?? 'Hindi'}, in the script that language is written in, natural for shoppers. Keep brand and product names as they are.`,
}

/** The model's words as plain text: no quotes, labels or fences around them, within a sane length. */
export function cleanWords(raw: string, original: string): string {
  let s = raw.trim().replace(/^```[a-z]*\s*|\s*```$/g, '').trim()
  s = s.replace(/^(?:here(?:'s| is)[^:]*:|rewritten:|translation:|shorter:)\s*/i, '').trim()
  if (/^(["'“‘]).*(["'”’])$/s.test(s)) s = s.slice(1, -1).trim()
  return s.replace(/\s+/g, ' ').slice(0, Math.max(120, original.length * 3))
}

/** One element's words reworked as asked. Throws when the model gives nothing back. */
export async function reworkText(p: { text: string; action: TextAction; language?: Language; context?: string }): Promise<string> {
  const text = p.text.trim().slice(0, 1500)
  if (!text) throw new Error('There are no words to work on')
  const raw = await chat(
    [
      {
        role: 'system',
        content: 'You edit the words on an Indian business website. Reply with the new words only: no quotes, no notes, no markdown, nothing else.',
      },
      { role: 'user', content: `${p.context ? `They are on: ${p.context.slice(0, 200)}\n` : ''}${ASK[p.action](p.language)}\n\n${text}` },
    ],
    { maxTokens: Math.min(800, 80 + text.length * 2), temperature: p.action === 'translate' ? 0.2 : 0.6, modelHint: 'copy' }
  )
  const out = cleanWords(raw, text)
  if (!out) throw new Error('The AI gave no words back')
  return out
}

/** The stock shape that fits an image slot's aspect (an <Image aspect="…">). */
export function shapeOf(aspect?: string | null): StockShape {
  switch (aspect) {
    case '1:1':
      return 'square'
    case '4:5':
    case '3:4':
    case '2:3':
      return 'portrait'
    case '16:9':
    case '21:9':
    case '3:1':
      return 'wide'
    default:
      return 'landscape'
  }
}

const SIZE: Record<StockShape, [number, number]> = { hero: [1600, 900], wide: [1536, 864], landscape: [1344, 1008], portrait: [960, 1200], story: [864, 1536], square: [1024, 1024] }

/**
 * A picture for an image slot: stock first (credited; `skipGallery` for a Showcase, whose credits travel with its
 * page), else generated at draft quality while `aiAllowed` says so. Null when neither made one.
 */
export async function slotPicture(p: { subject: string; category?: string; aspect?: string | null; seed: number; skipGallery?: boolean; ref: string; aiAllowed?: () => boolean }): Promise<Picture | null> {
  const shape = shapeOf(p.aspect)
  const subject = p.subject.trim().slice(0, 200) || p.category || 'shop'
  const [width, height] = SIZE[shape]
  return pictureFor({
    stock: { queries: [searchTerms(subject), ...(p.category ? [searchTerms(p.category, 3)] : [])], shape, seed: p.seed, used: new Set(), skipGallery: p.skipGallery },
    ai: {
      prompt: `${subject}${p.category ? `. For a ${p.category} business in India` : ''}. Photographic, natural light, no text, no logos, no watermarks.`,
      negativePrompt: 'text, letters, watermark, logo, distorted hands',
      width,
      height,
      feature: 'homepage_image',
      quality: 'draft',
      ref: p.ref,
      ...(p.skipGallery ? { skipGallery: true } : {}),
    },
    aiAllowed: p.aiAllowed,
  })
}
