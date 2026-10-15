'use client'

import { useMemo, useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import { sampleVariableMap } from '@/lib/templates/variables-shared'
import type { EditorTemplate } from './TemplateEditor'

// "Send via API": a ready-to-copy curl for POST /v1/messages built from this template — its variables
// with sample values, WhatsApp {{n}} slots, and media_url / button_url when it has an image or link button.

const API_BASE = 'https://public.jeffistores.in'
const TOKEN = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g
const SLOT = /\{\{\s*(\d+)\s*\}\}/g
// Filled by the API on every send; callers only pass them to override.
const AUTO = new Set(['store_name', 'store_email', 'store_phone', 'store_web', 'current_year', 'date', 'customer_email'])

const curlFor = (path: string, body: unknown, idem = true) => [
  `curl -X POST ${API_BASE}${path} \\`,
  `  -H "Authorization: Bearer $JEFFI_API_KEY" \\`,
  `  -H "Content-Type: application/json" \\`,
  ...(idem ? [`  -H "Idempotency-Key: $(uuidgen)" \\`] : []),
  `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
].join('\n')

export default function ApiCurlHint({ value, note }: { value: EditorTemplate; note?: string }) {
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const { single, bulk } = useMemo(() => {
    const samples = sampleVariableMap()
    const blocks = (value.blocks && typeof value.blocks === 'object' ? value.blocks : {}) as any
    const to = value.channel === 'email' ? 'customer@example.com' : '+919876543210'
    const to2 = value.channel === 'email' ? 'another@example.com' : '+919812345678'
    const extra: Record<string, unknown> = {}
    let variables: Record<string, string> | undefined
    if (value.channel === 'whatsapp') {
      const slots = [...new Set([...(value.body ?? '').matchAll(SLOT)].map(m => m[1]))].sort((a, b) => +a - +b)
      if (slots.length) variables = Object.fromEntries(slots.map(n => [n, blocks.variables?.[n] || `value ${n}`]))
      if (/\{\{\s*\d+\s*\}\}/.test(blocks.types?.['twilio/media']?.media?.[0] ?? '')) extra.media_url = 'https://dm9rri2wgl1e.cloudfront.net/products/…/photo.jpg'
      if ((blocks.buttons ?? []).some((b: any) => b.type === 'url' && /\{\{\s*\d+\s*\}\}/.test(b.value ?? ''))) extra.button_url = 'https://your-store.example/products/…'
    } else {
      const names = [...new Set([...`${value.subject ?? ''} ${value.body ?? ''}`.matchAll(TOKEN)].map(m => m[1]))].filter(k => !AUTO.has(k) && !/^\d+$/.test(k))
      if (names.length) variables = Object.fromEntries(names.map(k => [k, samples[k] ?? `<${k}>`]))
    }
    const template = value.slug || 'your/template-slug'
    const one = (addr: string, ref?: string) => ({ to: addr, ...(variables ? { variables } : {}), ...extra, ...(ref ? { reference: ref } : {}) })
    return {
      single: curlFor('/v1/messages', { channel: value.channel, template, ...one(to) }),
      bulk: [
        `# Up to 10 000 recipients; returns a job id right away (202).`,
        curlFor('/v1/messages/bulk', { channel: value.channel, template, reference: 'my-campaign', recipients: [one(to, 'cust-1'), one(to2, 'cust-2')] }),
        '',
        `# Progress, then per-recipient results`,
        `curl ${API_BASE}/v1/messages/bulk/$JOB_ID -H "Authorization: Bearer $JEFFI_API_KEY"`,
        `curl ${API_BASE}/v1/messages/bulk/$JOB_ID/items -H "Authorization: Bearer $JEFFI_API_KEY"`,
      ].join('\n'),
    }
  }, [value.channel, value.slug, value.subject, value.body, value.blocks])
  const curl = mode === 'single' ? single : bulk

  return (
    <details className="group rounded-lg border border-border-default bg-surface-secondary/40">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-foreground-secondary">
        <Terminal className="w-4 h-4" /> Send via API
        <span className="ml-auto text-[11px] font-normal text-foreground-muted group-open:hidden">Show curl</span>
      </summary>
      <div className="space-y-2 px-4 pb-4">
        <div role="tablist" className="inline-flex rounded-full bg-surface-secondary p-0.5">
          {(['single', 'bulk'] as const).map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setCopied(false) }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
              {m === 'single' ? 'Single message' : 'Bulk'}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 pr-10 text-[11.5px] leading-relaxed text-zinc-100"><code>{curl}</code></pre>
          <button
            type="button"
            aria-label="Copy curl"
            onClick={() => navigator.clipboard?.writeText(curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
            className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-zinc-200 hover:bg-white/20"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-foreground-muted">
          Sample values shown — replace them per recipient. Store details, date and the recipient&apos;s email fill in automatically.{mode === 'bulk' && ' In bulk, top-level variables apply to everyone and each recipient\'s own override them.'}
          {value.channel === 'whatsapp' && ' WhatsApp templates must be approved by Meta before they can be sent.'}
          {note && <> {note}</>}
        </p>
      </div>
    </details>
  )
}
