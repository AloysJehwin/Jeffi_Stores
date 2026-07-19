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

export interface CartLine {
  name: string
  category?: string | null
  brand?: string | null
  qty: number
}

export interface SessionSignals {
  /** Items currently in the cart. */
  cart: CartLine[]
  /** Product names viewed this session (most-recent first), deduped. */
  viewed?: string[]
  /** Category names of the user's past orders (anonymized, no order detail). */
  pastCategories?: string[]
  /** Search terms used this visit. */
  searches?: string[]
  /** Cart total in INR (rounded). */
  total?: number | null
  /** Item count (sum of quantities). */
  itemCount?: number | null
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

  lines.push('### Recap')
  return lines.join('\n')
}

/** Instruction prefix prepended to the serialized signals for the base/-it model. */
export const RECAP_INSTRUCTION =
  'You are a friendly shopping assistant for an industrial hardware store. ' +
  'Write a warm, concise 2–3 sentence recap of what the customer is about to buy, ' +
  'noting how the items fit together and reassuring them. Do not invent products or prices.'

/** Full prompt (instruction + signals) for chat-style inference/training. */
export function buildRecapPrompt(sig: SessionSignals): string {
  return `${RECAP_INSTRUCTION}\n\n${serializeSignals(sig)}`
}
