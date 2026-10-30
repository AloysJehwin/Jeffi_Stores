import { sampleVariableMap } from '@/lib/templates/variables-shared'
import type { EditorTemplate } from './TemplateEditor'

// What a POST /v1/messages call for this template needs: its variables (with sample values),
// WhatsApp {{n}} slots, and media_url / button_url when it has an image or link button slot.

export const API_BASE = 'https://public.jeffistores.in'
const TOKEN = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g
const SLOT = /\{\{\s*(\d+)\s*\}\}/g
// Filled by the API on every send; callers only pass them to override.
export const AUTO_VARIABLES = new Set(['store_name', 'store_email', 'store_phone', 'store_web', 'current_year', 'date', 'customer_email'])

export const curlFor = (path: string, body: unknown, idem = true) => [
  `curl -X POST ${API_BASE}${path} \\`,
  `  -H "Authorization: Bearer $JEFFI_API_KEY" \\`,
  `  -H "Content-Type: application/json" \\`,
  ...(idem ? [`  -H "Idempotency-Key: $(uuidgen)" \\`] : []),
  `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
].join('\n')

export function templateCallFields(value: Pick<EditorTemplate, 'channel' | 'subject' | 'body' | 'blocks'>): {
  variables?: Record<string, string>; mediaSlot: boolean; buttonSlot: boolean
} {
  const blocks = (value.blocks && typeof value.blocks === 'object' ? value.blocks : {}) as any
  let variables: Record<string, string> | undefined
  if (value.channel === 'whatsapp') {
    const slots = [...new Set([...(value.body ?? '').matchAll(SLOT)].map(m => m[1]))].sort((a, b) => +a - +b)
    if (slots.length) variables = Object.fromEntries(slots.map(n => [n, blocks.variables?.[n] || `value ${n}`]))
    return {
      variables,
      mediaSlot: /\{\{\s*\d+\s*\}\}/.test(blocks.types?.['twilio/media']?.media?.[0] ?? ''),
      buttonSlot: (blocks.buttons ?? []).some((b: any) => b.type === 'url' && /\{\{\s*\d+\s*\}\}/.test(b.value ?? '')),
    }
  }
  const samples = sampleVariableMap()
  const names = [...new Set([...`${value.subject ?? ''} ${value.body ?? ''}`.matchAll(TOKEN)].map(m => m[1]))].filter(k => !AUTO_VARIABLES.has(k) && !/^\d+$/.test(k))
  if (names.length) variables = Object.fromEntries(names.map(k => [k, samples[k] ?? `<${k}>`]))
  return { variables, mediaSlot: false, buttonSlot: false }
}
