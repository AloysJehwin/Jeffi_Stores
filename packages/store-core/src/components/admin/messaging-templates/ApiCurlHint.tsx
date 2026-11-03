'use client'

import { useMemo, useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import type { EditorTemplate } from './TemplateEditor'
import { API_BASE, curlFor, templateCallFields } from './template-call-fields'

// "Send via API": a ready-to-copy curl for POST /v1/messages built from this template.

export default function ApiCurlHint({ value, note }: { value: EditorTemplate; note?: string }) {
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const { single, bulk } = useMemo(() => {
    const to = value.channel === 'email' ? 'customer@example.com' : '+919876543210'
    const to2 = value.channel === 'email' ? 'another@example.com' : '+919812345678'
    const { variables, mediaSlot, buttonSlot } = templateCallFields({ channel: value.channel, subject: value.subject, body: value.body, blocks: value.blocks })
    const extra: Record<string, unknown> = {}
    if (mediaSlot) extra.media_url = 'https://dm9rri2wgl1e.cloudfront.net/products/…/photo.jpg'
    if (buttonSlot) extra.button_url = 'https://your-store.example/products/…'
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
