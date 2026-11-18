import type { ShowcaseBusiness, ShowcaseContent, ShowcaseFaq, ShowcaseService } from './types'
import { businessView } from './views'

// Starter content for a Showcase whose owner gave little: services (or menu highlights) and questions with answers,
// suggested from the brief (lib/site/studio/showcase.ts showcaseStarter) and marked `ai`, so the editor shows them as
// suggestions to check. Nothing in them is a fact the owner did not give: no price, hours, address, year, count,
// award or promise, and never a review. An answer that needs a fact says how to reach the business instead.

export const STARTER_LIMITS = { services: 6, faqs: 6 } as const

const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const list = (v: unknown) => (Array.isArray(v) ? v : [])
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max).trim()

// Facts and claims a suggestion may not make: numbers (prices, hours, years, counts), money, ratings and boasts.
const CLAIM =
  /\d|₹|\brs\.?(?=\s|$)|%|\b(awards?|award-winning|certified|certificates?|guarantee[ds]?|best|finest|number one|since|years?|decades?|rated|ratings?|stars?|reviews?|testimonials?|famous|renowned|leading|premier|trusted|thousands|hundreds|free delivery|home delivery|24\/7|round the clock)\b/i
// An answer may not say when the business is open either.
const WHEN = /\b(daily|every ?day|weekdays|weekends|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|morning|evening|night|a\.?m\.?|p\.?m\.?)\b/i

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** How the business can be reached, as an answer says it: "call us, message us on WhatsApp or leave your details…". */
export function reachText(b: ShowcaseBusiness): string {
  const v = businessView(b)
  const ways = [v.phoneUrl && 'call us', v.whatsappUrl && 'message us on WhatsApp', v.emailUrl && 'email us', 'leave your details in the form on this page'].filter(Boolean) as string[]
  return ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}` : ways[0]
}

/** Questions any business gets, answered with nothing but the ways to reach it. */
export function starterFaqs(b: ShowcaseBusiness): ShowcaseFaq[] {
  const reach = reachText(b)
  return [
    { q: 'How can I get in touch?', a: `${sentence(reach)}, and we will get back to you.`, ai: true },
    { q: 'Can I ask about something that is not on this page?', a: `Yes: ${reach}, and tell us what you need.`, ai: true },
  ]
}

/** What the AI suggested, kept only where it states nothing the owner did not give; each item marked `ai`. */
export function cleanStarter(raw: unknown): { services: ShowcaseService[]; faqs: ShowcaseFaq[] } {
  const o = rec(raw)
  const seen = new Set<string>()
  const services: ShowcaseService[] = list(o.services)
    .map(rec)
    .map(x => {
      const title = text(x.title ?? x.name, 60)
      const description = text(x.description, 220)
      return { title, ...(description && !CLAIM.test(description) ? { description } : {}), ai: true }
    })
    .filter(x => x.title.length >= 3 && !CLAIM.test(x.title) && !seen.has(x.title.toLowerCase()) && (seen.add(x.title.toLowerCase()), true))
    .slice(0, STARTER_LIMITS.services)
  const faqs: ShowcaseFaq[] = list(o.faqs ?? o.questions)
    .map(rec)
    .map(x => ({ q: text(x.q ?? x.question, 140), a: text(x.a ?? x.answer, 400), ai: true }))
    .filter(x => x.q.length >= 8 && x.a.length >= 8 && !/\d/.test(x.q) && !CLAIM.test(x.a) && !WHEN.test(x.a))
    .slice(0, STARTER_LIMITS.faqs - 2)
  return { services, faqs }
}

/**
 * What a build adds to a business's content: suggested services where it has none, and questions (the suggested ones
 * and starterFaqs) where it has none. Its own lists are never touched.
 */
export function starterFill(content: ShowcaseContent, suggested: { services: ShowcaseService[]; faqs: ShowcaseFaq[] }, b: ShowcaseBusiness): Partial<Pick<ShowcaseContent, 'services' | 'faqs'>> {
  const fill: Partial<Pick<ShowcaseContent, 'services' | 'faqs'>> = {}
  if (!(content.services ?? []).length && suggested.services.length) fill.services = suggested.services
  if (!(content.faqs ?? []).length) {
    const asked = new Set<string>()
    fill.faqs = [...suggested.faqs, ...starterFaqs(b)].filter(f => !asked.has(f.q.toLowerCase()) && (asked.add(f.q.toLowerCase()), true)).slice(0, STARTER_LIMITS.faqs)
  }
  return fill
}
