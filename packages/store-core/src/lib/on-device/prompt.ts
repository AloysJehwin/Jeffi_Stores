/**
 * Shared prompt serialization for the on-device checkout recap model.
 *
 * SINGLE SOURCE OF TRUTH: the exact text format produced here is what the model
 * is fine-tuned on (via scripts/gen-onboarding-dataset.mjs) AND what the browser
 * runtime feeds at inference. If this format changes, the model must be retrained.
 *
 * Privacy: signals are aggregated / anonymized — product names, categories,
 * brands, counts and totals only. NEVER names, addresses, emails, phone, or any
 * PII (honors ADR-0001's constraint). Inference is on-device regardless.
 */

import type { UserProfile } from './user-profile'

export interface CartLine {
  name: string
  category?: string | null
  brand?: string | null
  qty: number
}

export interface SessionSignals {
  cart: CartLine[]
  viewed?: string[]
  pastCategories?: string[]
  searches?: string[]
  total?: number | null
  itemCount?: number | null
  /** Persistent user profile — adds personalisation across sessions. */
  userProfile?: UserProfile | null
  /** Recap feedback preference derived from past 👍/👎. */
  recapStyle?: 'concise' | 'detailed' | null
}

const MAX_CART = 12
const MAX_VIEWED = 8
const MAX_PAST = 6
const MAX_SEARCH = 6

function clampList(xs: (string | null | undefined)[] | undefined, n: number): string[] {
  if (!xs) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = (x ?? '').trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= n) break
  }
  return out
}

/**
 * Render signals into the fixed prompt string the model consumes. Deterministic
 * and compact. The model is trained to continue this with a 2–3 sentence recap.
 */
export function serializeSignals(sig: SessionSignals): string {
  const cart = (sig.cart || []).slice(0, MAX_CART)
  const lines: string[] = []

  lines.push('### Cart')
  if (cart.length === 0) {
    lines.push('(empty)')
  } else {
    for (const it of cart) {
      const meta = [it.brand, it.category].filter(Boolean).join(', ')
      lines.push(`- ${it.qty}x ${it.name}${meta ? ` (${meta})` : ''}`)
    }
  }
  if (sig.itemCount != null || sig.total != null) {
    const bits = [
      sig.itemCount != null ? `${sig.itemCount} items` : null,
      sig.total != null ? `total Rs.${Number(sig.total).toFixed(2)}` : null,
    ].filter(Boolean)
    if (bits.length) lines.push(`Summary: ${bits.join(', ')}`)
  }

  const viewed = clampList(sig.viewed, MAX_VIEWED)
  if (viewed.length) {
    lines.push('### Also viewed')
    lines.push(viewed.map(v => `- ${v}`).join('\n'))
  }

  const past = clampList(sig.pastCategories, MAX_PAST)
  if (past.length) {
    lines.push('### Previously bought categories')
    lines.push(past.join(', '))
  }

  const searches = clampList(sig.searches, MAX_SEARCH)
  if (searches.length) {
    lines.push('### Searched for')
    lines.push(searches.join(', '))
  }

  // User profile — personalises the recap across sessions
  const profile = sig.userProfile
  if (profile && (profile.topCategories.length || profile.topBrands.length || profile.purchaseCount > 0)) {
    const bits: string[] = []
    if (profile.topCategories.length) bits.push(`Frequent: ${profile.topCategories.slice(0, 3).join(', ')}`)
    if (profile.topBrands.length) bits.push(`Brands: ${profile.topBrands.slice(0, 3).join(', ')}`)
    if (profile.priceRange)
      bits.push(`Budget: Rs.${Math.round(profile.priceRange.min)}–Rs.${Math.round(profile.priceRange.max)}`)
    if (profile.purchaseCount > 0) bits.push(`Orders: ${profile.purchaseCount}`)
    if (bits.length) {
      lines.push('### Profile')
      lines.push(bits.join(' | '))
    }
  }

  if (sig.recapStyle) {
    lines.push('### Style')
    lines.push(sig.recapStyle)
  }

  lines.push('### Recap')
  return lines.join('\n')
}

/** Instruction prefix prepended to the serialized signals for the base/-it model. */
export const RECAP_INSTRUCTION =
  'You are a friendly shopping assistant for an online store. ' +
  'Write a warm, concise 2–3 sentence recap of what the customer is about to buy, ' +
  'noting how the items fit together and reassuring them. Do not invent products or prices.'

/** Full prompt (instruction + signals) for chat-style inference/training. */
export function buildRecapPrompt(sig: SessionSignals): string {
  return `${RECAP_INSTRUCTION}\n\n${serializeSignals(sig)}`
}

/** Prompt for cart insight — narrates what the cart collectively adds up to. */
export function buildCartInsightPrompt(sig: SessionSignals): string {
  const instruction =
    'You are a friendly shopping assistant for an online store. ' +
    'In one short sentence (max 20 words), describe what the customer appears to be shopping for based on their cart. ' +
    'Be specific and practical. Do not mention prices.'
  return `${instruction}\n\n${serializeSignals(sig)}\n### Insight`
}

/** Prompt for a personalised 1-sentence product pitch. */
export function buildProductPitchPrompt(
  productName: string,
  brand: string | null,
  category: string | null,
  profile: import('./user-profile').UserProfile | null
): string {
  const instruction =
    'You are a friendly shopping assistant for an online store. ' +
    "Write exactly one sentence (max 20 words) explaining why this product fits the customer's needs based on their history. " +
    'Be specific. Do not mention prices or make things up.'
  const lines = [`### Product\n${productName}${brand ? ` (${brand})` : ''}${category ? ` — ${category}` : ''}`]
  if (profile && (profile.topCategories.length || profile.topBrands.length)) {
    const bits: string[] = []
    if (profile.topCategories.length) bits.push(`Frequent: ${profile.topCategories.slice(0, 3).join(', ')}`)
    if (profile.topBrands.length) bits.push(`Brands: ${profile.topBrands.slice(0, 3).join(', ')}`)
    lines.push(`### Profile\n${bits.join(' | ')}`)
  }
  lines.push('### Pitch')
  return `${instruction}\n\n${lines.join('\n')}`
}

/** Prompt for post-purchase affirmation on the order confirmation page. */
export function buildAffirmationPrompt(
  itemNames: string[],
  total: number,
  profile: import('./user-profile').UserProfile | null
): string {
  const instruction =
    'You are a friendly shopping assistant for an online store. ' +
    "Write one warm sentence (max 20 words) affirming the customer's purchase decision. " +
    'Reference what they bought. Do not mention prices.'
  const lines = [
    `### Purchased\n${itemNames
      .slice(0, 5)
      .map(n => `- ${n}`)
      .join('\n')}`,
  ]
  if (profile?.topCategories.length) {
    lines.push(`### Profile\nFrequent: ${profile.topCategories.slice(0, 3).join(', ')}`)
  }
  lines.push('### Affirmation')
  return `${instruction}\n\n${lines.join('\n')}`
}
