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

/** Meta's rejection rules we can check before spending a submission. Empty array = OK. */
export function validateForMeta(body: string, blocks: WaBlocks | null | undefined, samples: Record<string, string>): string[] {
  const errs: string[] = []
  const text = (body || '').trim()
  if (!text) errs.push('Body is empty.')
  if (text.length > 1024) errs.push(`Body is ${text.length} characters; Meta allows 1024.`)
  if (/^\{\{\s*\d+\s*\}\}/.test(text)) errs.push('Body cannot start with a variable — add text before {{1}}.')
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(text)) errs.push('Body cannot end with a variable — add text after the last {{n}}.')
  const named = [...new Set([text, ...(blocks?.buttons ?? []).map(x => x.value ?? '')].join(' ').match(NAMED) ?? [])]
  if (named.length) errs.push(`WhatsApp variables are numbered: replace ${named.join(', ')} with {{1}}, {{2}} … in order.`)
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
