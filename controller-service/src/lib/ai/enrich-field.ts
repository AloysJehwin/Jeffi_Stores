import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { BUILTIN_TEMPLATE_VARIABLES, type TemplateVariableDef } from '@/lib/templates/variables-shared'

// "Enrich with AI" for one form field. Format-aware (plain · subject · label · sms · whatsapp · html),
// keeps every merge variable in place, and can write from scratch when the field is empty.

export type EnrichFormat = 'plain' | 'subject' | 'label' | 'sms' | 'whatsapp' | 'html'
export const ENRICH_FORMATS: EnrichFormat[] = ['plain', 'subject', 'label', 'sms', 'whatsapp', 'html']

export interface EnrichInput {
  store: string // store descriptor for the prompt
  fieldLabel: string
  value: string
  context?: string
  format?: EnrichFormat
  variables?: string[] // extra variable names the caller's template fills
  maxLength?: number
  write?: boolean // allowed to draft when value is empty
  builtins?: TemplateVariableDef[] // defaults to BUILTIN_TEMPLATE_VARIABLES
  broadcast?: boolean // no order context → drop order variables
}

const TOKEN_RULES = `MERGE VARIABLES — the text may contain tokens like {first_name}, {{store_name}}, numbered WhatsApp slots {{1}} {{2}}, and conditional blocks {#if couponCode}…{/if}. Keep every token EXACTLY as written (same braces, same name, same number) and in a sensible place; never invent new tokens, never write a token's value out, never put a token inside a URL or a button label.`

const FORMAT_RULES: Record<EnrichFormat, string> = {
  plain: 'Plain text only — no HTML, no markdown.',
  subject: 'An email subject line: one line, at most 9 words, no trailing punctuation, no ALL CAPS, no emoji unless the current value has one.',
  label: 'A button label: 1–3 words, at most 25 characters, no punctuation, no emoji.',
  sms: 'An SMS: plain text, GSM-7 characters only (no emoji, no smart quotes), ideally under 160 characters; keep any URL or {short_url} token.',
  whatsapp: 'A WhatsApp template body (Meta reviews it): plain text, *bold* _italic_ allowed, under 1024 characters, no URLs in the body, numbered slots {{1}} {{2}}… must all remain in order; friendly but not spammy; no promotional ALL CAPS.',
  html: 'An email body fragment: valid HTML with inline styles only (no <html>/<head>/<body>/<style>), keep all existing links, images and the call-to-action button markup; paragraphs as <p>, headings as <h2>; do not set text colours or fonts.',
}

const PLACEMENT = `WHERE VARIABLES BELONG: a first-name token only in the greeting; {couponCode}/{discountPercent} only inside {#if couponCode}…{/if}; store name/contact tokens in sign-offs and contact lines; date tokens as plain text.`

export function buildEnrichMessages(i: EnrichInput) {
  const format = i.format ?? 'plain'
  const defs = (i.builtins ?? BUILTIN_TEMPLATE_VARIABLES).filter(d => !i.broadcast || d.group !== 'order')
  const extra = (i.variables ?? []).filter(k => /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k) && !defs.some(d => d.key === k)).slice(0, 40)
  const vars = [
    ...defs.map(d => `  {${d.key}} — ${d.label}${d.description ? `: ${d.description}` : ''}`),
    ...extra.map(k => `  {${k}} — filled for this message`),
  ].join('\n')
  const empty = !i.value.trim()
  const system = `You are a copywriting assistant for ${i.store}.
${empty ? 'Write the field from the context given.' : 'Improve the given field value: clearer, more professional, more useful — keep its meaning, facts and length class (brief stays brief).'}
FORMAT — ${FORMAT_RULES[format]}${i.maxLength ? ` Hard limit: ${i.maxLength} characters.` : ''}
${TOKEN_RULES}
${PLACEMENT}
AVAILABLE VARIABLES (use one instead of writing a value that would differ per customer):
${vars}
Do not assume a product category or industry the store has not described. Do not change factual data.
Return ONLY JSON: {"result":"<text>"} — no explanation, no markdown fences.`
  const user = [
    i.context ? `Context: ${i.context}` : null,
    `Field: ${i.fieldLabel}`,
    empty ? 'Current value: (empty — write it)' : `Current value: ${i.value}`,
    empty ? 'Write this field.' : 'Enrich this field value.',
  ].filter(Boolean).join('\n')
  return [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }]
}

const TOKEN = /\{\{?\s*(#if\s+[a-zA-Z_]\w*|\/if|[a-zA-Z_]\w*|\d+)\s*\}?\}/g
const tokens = (t: string) => [...t.matchAll(TOKEN)].map(m => ({ raw: m[0], key: m[1].replace(/\s+/g, ' ') }))

/**
 * Models drift on merge tags (brace style, dropped slots, invented tokens). Put every original token
 * back in its exact form; report what cannot be repaired so the caller can retry or fail.
 */
export function preserveTokens(original: string, result: string, allowed: Set<string>): { text: string; problems: string[] } {
  const want = tokens(original)
  let text = result
  const problems: string[] = []
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Exact form only: "{x}" inside "{{x}}" does not count.
  const exact = (raw: string) => new RegExp(`(?<!\\{)${esc(raw)}(?!\\})`).test(text)
  for (const t of want) {
    if (exact(t.raw)) continue
    // Same key, different braces → normalise back.
    const alt = text.match(new RegExp(`\\{\\{?\\s*${esc(t.key)}\\s*\\}?\\}`))
    if (alt) text = text.replace(alt[0], t.raw)
    else problems.push(`missing ${t.raw}`)
  }
  const wantKeys = new Set(want.map(t => t.key))
  for (const t of tokens(text)) {
    if (wantKeys.has(t.key) || allowed.has(t.key) || /^(#if|\/if)/.test(t.key)) continue
    problems.push(`invented ${t.raw}`)
  }
  return { text, problems }
}

/** Runs the model and returns the enriched text (throws with a user-facing message on failure). */
export async function enrichField(i: EnrichInput): Promise<string> {
  if (!i.write && i.value.trim().length < 2) throw Object.assign(new Error('Value too short to enrich'), { status: 400 })
  const allowed = new Set([...(i.builtins ?? BUILTIN_TEMPLATE_VARIABLES).map(d => d.key), ...(i.variables ?? [])])
  // WhatsApp bodies: only the numbered slots that already exist may be used.
  if (i.format === 'whatsapp') allowed.clear()
  const messages = buildEnrichMessages(i)
  let strict = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await aiChat({
      modelHint: 'enrich',
      jsonMode: true,
      temperature: i.value.trim() ? 0.3 : 0.6,
      noCache: true,
      messages: strict ? [...messages, { role: 'user' as const, content: strict }] : messages,
    })
    const obj = parseAiJson<{ result?: string }>(r.content)
    const raw = String(obj?.result || '').trim()
    if (!raw) throw Object.assign(new Error('AI returned an empty result'), { status: 502 })
    const { text, problems } = preserveTokens(i.value, raw, allowed)
    if (!problems.length) return i.maxLength && text.length > i.maxLength ? text.slice(0, i.maxLength) : text
    strict = `Your previous answer broke the merge-variable rules (${problems.join(', ')}). Rewrite it: keep every original token exactly as written and add no new tokens. Return only {"result":"…"}.`
  }
  throw Object.assign(new Error('AI kept changing the merge variables — try again or edit by hand'), { status: 502 })
}

export function parseEnrichBody(body: any) {
  return {
    fieldLabel: typeof body?.fieldLabel === 'string' ? body.fieldLabel.slice(0, 120) : 'field',
    value: typeof body?.value === 'string' ? body.value.slice(0, 20000) : '',
    context: typeof body?.context === 'string' ? body.context.slice(0, 2000) : undefined,
    format: ENRICH_FORMATS.includes(body?.format) ? (body.format as EnrichFormat) : 'plain',
    variables: Array.isArray(body?.variables) ? body.variables.filter((v: unknown) => typeof v === 'string') : [],
    maxLength: Number.isFinite(Number(body?.maxLength)) && Number(body.maxLength) > 0 ? Math.min(Number(body.maxLength), 20000) : undefined,
    write: body?.write === true,
    broadcast: body?.broadcast === true,
  }
}
