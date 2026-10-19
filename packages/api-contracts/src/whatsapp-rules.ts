// WhatsApp template rules shared by messaging-service (checked before submitting to Meta) and the admin
// editor (explains a rejection Meta gave no reason for).
export type WaButton = { type: 'quick_reply' | 'url' | 'phone'; label: string; value?: string }
export type WaCard = { title?: string; body?: string; media_url?: string; buttons?: WaButton[] }
export type WaBlocks = { types?: Record<string, any>; variables?: Record<string, string>; buttons?: WaButton[]; carousel?: { cards?: WaCard[] } }

const PH = /\{\{\s*(\d+)\s*\}\}/g
const NAMED = /\{\{?\s*[A-Za-z_][\w.]*\s*\}?\}/g
export const placeholders = (s: string) => [...new Set([...(s || '').matchAll(PH)].map(m => m[1]))].sort((a, b) => +a - +b)

/** {{n}} used outside the body: header media URL and URL-button suffixes (per-send image / link). */
export function extraSlots(blocks: WaBlocks | null | undefined): string[] {
  const b = blocks ?? {}
  return placeholders([b.types?.['twilio/media']?.media?.[0] ?? '', ...(b.buttons ?? []).map(x => x.value ?? '')].join(' '))
}

// {{brand_name}}: the sending store's name. Editors write the token; Meta sees the next number after
// the body's own variables, and every send fills it from the store's name.
export const BRAND_VAR = 'brand_name'
export const BRAND_SAMPLE = 'Jeffi Stores'
const BRAND = /\{\{\s*brand_name\s*\}\}/g
const LEGACY_TAIL = /— from \{\{\s*(\d+)\s*\}\} team(\s*)$/

/** Rows saved before the token end "— from {{N}} team" with N the last slot; that slot is the brand. */
export function withBrandToken(body: string): string {
  const s = body || ''
  const m = s.match(LEGACY_TAIL)
  if (!m || /\{\{\s*brand_name\s*\}\}/.test(s)) return s
  return placeholders(s).slice(-1)[0] === m[1] ? s.replace(LEGACY_TAIL, `— from {{${BRAND_VAR}}} team$2`) : s
}

export type Remap = { from: string; to: string }
export type WaSlotPlan = {
  /** Body with {{brand_name}} numbered — what Meta approves. */
  body: string
  /** Header media / button {{n}} renumbered to continue after the body. */
  blocks: WaBlocks
  samples: Record<string, string>
  /** The caller's numbered body variables. */
  bodySlots: string[]
  brandSlot: string | null
  media: Remap | null
  /** One per button; null when that button has no variable. */
  links: Array<Remap | null>
}

/**
 * The one slot layout shared by submit and send: body variables 1..k, then {{brand_name}} as k+1,
 * then header media, then each button, each taking the next number. Stored blocks keep whatever
 * numbering the editor gave them; `samples` are keyed by that stored numbering.
 */
export function planSlots(body: string, blocks: WaBlocks | null | undefined, samples: Record<string, string> = {}): WaSlotPlan {
  const b = blocks ?? {}
  const src = withBrandToken(body)
  const bodySlots = placeholders(src)
  let next = bodySlots.reduce((m, v) => Math.max(m, +v), 0)
  const brandSlot = /\{\{\s*brand_name\s*\}\}/.test(src) ? String(++next) : null
  const out: Record<string, string> = {}
  for (const v of bodySlots) if (samples[v] !== undefined) out[v] = samples[v]
  if (brandSlot) out[brandSlot] = BRAND_SAMPLE
  // Each location numbers its own placeholders, so a stored {{1}} in the header and in a button are two slots.
  const relocate = (s: string): { s: string; first: Remap | null } => {
    const local: Record<string, string> = {}
    let first: Remap | null = null
    for (const n of placeholders(s)) {
      const to = String(++next)
      local[n] = to
      first ??= { from: n, to }
      const sample = b.variables?.[n] ?? samples[n]
      if (sample !== undefined) out[to] = sample
    }
    return { s: s.replace(PH, (_m, n: string) => `{{${local[n] ?? n}}}`), first }
  }
  const headerUrl: string | undefined = b.types?.['twilio/media']?.media?.[0]
  const header = headerUrl ? relocate(headerUrl) : null
  const btns = (b.buttons ?? []).map(btn => (btn.value ? relocate(btn.value) : null))
  const types = header
    ? { ...(b.types ?? {}), 'twilio/media': { ...(b.types?.['twilio/media'] ?? {}), media: [header.s, ...(b.types?.['twilio/media']?.media?.slice(1) ?? [])] } }
    : b.types
  const buttons = b.buttons?.map((btn, i) => (btns[i] ? { ...btn, value: btns[i]!.s } : btn))
  return {
    body: brandSlot ? src.replace(BRAND, `{{${brandSlot}}}`) : src,
    blocks: { ...b, types, buttons, variables: out },
    samples: out,
    bodySlots,
    brandSlot,
    media: header?.first ?? null,
    links: btns.map(x => x?.first ?? null),
  }
}

/** Meta's rejection rules we can check before spending a submission. Empty array = OK. */
export function validateForMeta(storedBody: string, storedBlocks: WaBlocks | null | undefined, storedSamples: Record<string, string>): string[] {
  const { body, blocks, samples } = planSlots(storedBody, storedBlocks, storedSamples)
  const errs: string[] = []
  const text = (body || '').trim()
  if (!text) errs.push('Body is empty.')
  if (text.length > 1024) errs.push(`Body is ${text.length} characters; Meta allows 1024.`)
  if (/^\{\{\s*\d+\s*\}\}/.test(text)) errs.push('Body cannot start with a variable — add text before {{1}}.')
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(text)) errs.push('Body cannot end with a variable — add text after the last {{n}}.')
  const named = [...new Set([text, ...(blocks?.buttons ?? []).map(x => x.value ?? '')].join(' ').match(NAMED) ?? [])]
  if (named.length) errs.push(`WhatsApp variables are numbered: replace ${named.join(', ')} with {{1}}, {{2}} … in order ({{brand_name}} is the only named one).`)
  const vars = placeholders(text)
  vars.forEach((v, i) => { if (+v !== i + 1) errs.push(`Variables must be numbered {{1}}, {{2}}, … in order (found {{${v}}}).`) })
  const words = text.replace(PH, '').split(/\s+/).filter(Boolean).length
  if (vars.length && words < vars.length * 3) errs.push('Too many variables for the message length — add more text around them.')
  for (const v of vars) if (!samples[v]?.trim()) errs.push(`Add a sample value for {{${v}}}.`)
  const extra = extraSlots(blocks)
  extra.forEach((v, i) => { if (+v !== vars.length + i + 1) errs.push(`Image/button variables must continue the numbering after the body (expected {{${vars.length + i + 1}}}).`) })
  for (const v of extra) if (!samples[v]?.trim()) errs.push(`Add a sample value for {{${v}}} (image path or link code).`)
  const all = [...(blocks?.buttons ?? []), ...(blocks?.carousel?.cards ?? []).flatMap(c => c.buttons ?? [])]
  if ((blocks?.buttons?.length ?? 0) > 3) errs.push('At most 3 buttons.')
  for (const btn of all) {
    if (!btn.label?.trim()) errs.push('Every button needs a label.')
    else if (btn.label.length > 25) errs.push(`Button "${btn.label}" is over 25 characters.`)
    if (btn.type === 'url' && !/^https:\/\//.test(btn.value ?? '')) errs.push(`Button "${btn.label}" needs an https:// URL.`)
    if (btn.type === 'phone' && !/^\+\d{8,15}$/.test(btn.value ?? '')) errs.push(`Button "${btn.label}" needs a phone like +919876543210.`)
  }
  return [...new Set(errs)]
}

const SAMPLE_BY_CONTEXT: Array<[RegExp, string]> = [
  [/(https?:|link|here|track|view|download|review|open)\W*$/i, 'https://jeffistores.in/account/orders'],
  [/(order|invoice|quotation|request|ticket)\s*#?\s*$/i, 'JS-10234'],
  [/(₹|rs\.?|total|amount|refund of)\s*$/i, '₹2,499'],
  [/code\s*$/i, 'WELCOME20'],
  [/(hi|hello|dear)\s*,?\s*$/i, 'Priya'],
]
/** Samples Meta reviews with. Keeps what the editor set; fills the rest from the text around {{n}}. */
export function samplesFor(body: string, given?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of placeholders(body)) {
    if (given?.[v]?.trim()) { out[v] = given[v]; continue }
    const before = body.slice(0, body.search(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`)))
    out[v] = SAMPLE_BY_CONTEXT.find(([re]) => re.test(before))?.[1] ?? 'Sample text'
  }
  return out
}

/** Samples for every slot: the body's (from the text around them) and the image/button ones as set. */
export function metaSamples(body: string, blocks: WaBlocks | null | undefined): Record<string, string> {
  return { ...samplesFor(body, blocks?.variables), ...Object.fromEntries(extraSlots(blocks).map(n => [n, blocks?.variables?.[n] ?? ''])) }
}

/** What to fix when Meta rejected without a reason: the rule breaks, else the usual review causes. */
export function rejectionHints(body: string, blocks: WaBlocks | null | undefined, category?: string | null): string[] {
  const errs = validateForMeta(body, blocks, metaSamples(body, blocks))
  if (errs.length) return errs
  return category === 'UTILITY'
    ? ['Utility templates must be about one order or account; promotional wording is rejected — submit it as Marketing.']
    : ['Make the text specific and plain: no vague offers, ALL CAPS, or runs of emoji and punctuation.']
}
