'use client'

import { useMemo, useRef, useState } from 'react'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import EmailBlockBuilder from '@/components/admin/email-composer/EmailBlockBuilder'
import { renderBlocks } from '@/lib/templates/blocks'
import AdminSelect from '@/components/admin/AdminSelect'
import EmojiPicker from './EmojiPicker'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm, usePrompt } from '@/contexts/ConfirmContext'
import { Smile, Link2, ImageIcon, Loader2, Upload, RefreshCw } from 'lucide-react'
import CampaignVariables from '@/components/admin/campaigns/CampaignVariables'
import PhonePreview from './PhonePreview'
import { campaignVariables, isCampaignKind, missingRequired } from '@/lib/campaigns/kind-variables'

export type Channel = 'email' | 'sms' | 'whatsapp'

export type EditorTemplate = {
  id?: string
  slug: string
  channel: Channel
  name: string
  category?: string | null
  subject?: string | null
  body: string
  blocks?: unknown
  blocks_format?: string | null
  meta_category?: string | null
  media_type?: string | null
  approval_status?: string | null
  approval_reason?: string | null
  needs_resubmission?: boolean
}

// messaging-service nests the published snapshot under current_version; the editor edits a flat shape.
export function toEditorTemplate(api: any): EditorTemplate {
  const v = api?.current_version ?? {}
  return {
    id: api.id, slug: api.slug ?? '', channel: api.channel, name: api.name ?? '', category: api.category ?? null,
    subject: v.subject ?? api.subject ?? '', body: v.body ?? api.body ?? '', blocks: v.blocks ?? api.blocks,
    blocks_format: v.blocks_format ?? api.blocks_format ?? null, meta_category: api.meta_category ?? null,
    media_type: api.media_type ?? null, approval_status: api.approval_status ?? null, approval_reason: api.approval_reason ?? null,
    needs_resubmission: !!api.needs_resubmission,
  }
}

export type WaCarouselCard = {
  title?: string
  body?: string
  media_url?: string
  buttons?: Array<WaButton>
}

export type WaButton = { type: 'quick_reply' | 'url' | 'phone'; label: string; value?: string }

type Props = {
  value: EditorTemplate
  apiBase: string
  assetsBase?: string
  shortLinksBase?: string
  onChange: (t: EditorTemplate) => void
  // Resolves to the saved template (a tenant's first save forks a standard one → new id), or null.
  onSave: (publish: boolean) => Promise<EditorTemplate | null>
  saving?: boolean
  /** Inside another editor (campaigns, Messaging): single column, no preview panel, one save action. */
  embedded?: boolean
  /** Campaign kind whose variables this template must use (else derived from a campaign/<kind> slug). */
  campaignKind?: string | null
  /** Variables to offer in the insert menu when not a campaign template (e.g. the picked template's own). */
  variableNames?: string[]
}

const SMS_GSM_LIMIT = 160
const SMS_UCS2_LIMIT = 70
const hasEmoji = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)


type WaBlocks = {
  types?: Record<string, any>
  variables?: Record<string, string>
  buttons?: WaButton[]
  carousel?: { cards: WaCarouselCard[] }
}

export default function TemplateEditor({ value, apiBase, assetsBase, shortLinksBase, onChange, onSave: rawSave, saving, embedded, campaignKind, variableNames }: Props) {
  const derived = campaignKind ?? (value.slug?.startsWith('campaign/') ? value.slug.slice('campaign/'.length) : null)
  const kind = isCampaignKind(derived) && value.channel !== 'whatsapp' ? derived : null
  const kindText = `${value.channel === 'email' ? value.subject ?? '' : ''}\n${value.body ?? ''}`
  const ownVars = useMemo(
    () => [...new Set([...(`${value.subject ?? ''} ${value.body ?? ''}`).matchAll(/\{\{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}?\}/g)].map(m => m[1]))]
      .filter(k => !/^(customer_|store_)|^(current_year|date)$/.test(k)),
    // Recomputed per template, not per keystroke, so the menu doesn't shift while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.slug, value.channel]
  )
  const composerVars = useMemo(() => {
    if (kind) return campaignVariables(kind, 'email').map(v => ({ key: v.key, label: v.label, description: v.description, sample: v.sample, group: 'order' as const, builtIn: true, section: 'Campaign' }))
    const names = [...new Set([...(variableNames ?? []), ...ownVars])]
    const human = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase())
    return names.length ? names.map(k => ({ key: k, label: human(k), description: 'Used by this template', sample: '', group: 'order' as const, builtIn: true, section: 'This template' })) : undefined
  }, [kind, variableNames, ownVars])
  const [preview, setPreview] = useState<{ subject?: string | null; body?: string; missing?: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const { showToast } = useToast()
  // A campaign template can't drop the variables its campaign depends on (e.g. the product gallery).
  const onSave = async (publish: boolean) => {
    const miss = missingRequired(kind, value.channel, kindText)
    if (miss.length) {
      showToast(`This template must use ${miss.map(k => `{${k}}`).join(', ')} — the campaign relies on ${miss.length === 1 ? 'it' : 'them'}.`, 'error')
      return null
    }
    return rawSave(publish)
  }
  const askText = usePrompt()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const uploadUrl = assetsBase ?? `${apiBase}/assets/upload`
  const shortUrl = shortLinksBase ?? `${apiBase}/short-links`

  const smsStats = useMemo(() => {
    if (value.channel !== 'sms') return null
    const limit = hasEmoji(value.body) ? SMS_UCS2_LIMIT : SMS_GSM_LIMIT
    const segments = Math.max(1, Math.ceil(value.body.length / limit))
    return { limit, segments, encoding: hasEmoji(value.body) ? 'UCS-2' : 'GSM-7', length: value.body.length }
  }, [value.body, value.channel])

  async function uploadFile(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    if (value.id) fd.append('templateId', value.id)
    setUploading(true)
    try {
      const r = await fetch(uploadUrl, { method: 'POST', body: fd })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        showToast(err?.error || `Upload failed (HTTP ${r.status})`, 'error')
        return null
      }
      const data = await r.json()
      return data.url as string
    } finally { setUploading(false) }
  }

  async function createShortLink(destination: string): Promise<string | null> {
    try {
      const r = await fetch(shortUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination_url: destination, kind: 'page', variant_id: value.id ?? null }),
      })
      if (!r.ok) return destination
      const data = await r.json()
      return (data.url as string) || destination
    } catch { return destination }
  }

  function pickFile(): Promise<File | null> {
    return new Promise(resolve => {
      const el = fileRef.current
      if (!el) return resolve(null)
      el.onchange = () => resolve(el.files?.[0] ?? null)
      el.value = ''
      el.click()
    })
  }

  function insertAtCursor(snippet: string) {
    const el = textRef.current
    if (!el) {
      onChange({ ...value, body: value.body + snippet })
      return
    }
    const start = el.selectionStart ?? value.body.length
    const end = el.selectionEnd ?? value.body.length
    const next = value.body.slice(0, start) + snippet + value.body.slice(end)
    onChange({ ...value, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + snippet.length
    })
  }

  async function onInsertShortLink() {
    const dest = await askText({ title: 'Insert short link', message: 'Where should the short link redirect?', placeholder: 'https://…', confirmLabel: 'Create link' })
    if (!dest) return
    const u = await createShortLink(dest)
    if (u) insertAtCursor(u)
  }

  async function onPickImageTextual() {
    const file = await pickFile()
    if (!file) return
    const uploaded = await uploadFile(file)
    if (!uploaded) return
    const u = await createShortLink(uploaded)
    insertAtCursor(u ?? uploaded)
  }

  async function runPreview() {
    setPreviewing(true)
    try {
      const res = await fetch(`${apiBase}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: value.channel, slug: value.slug, variables: {} }),
      })
      setPreview(await res.json())
    } finally {
      setPreviewing(false)
    }
  }

  const emojiPanel = showEmoji && <EmojiPicker onPick={insertAtCursor} onClose={() => setShowEmoji(false)} />

  const TOOL = 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors disabled:opacity-60'
  const toolbar = (
    <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
      <button type="button" data-emoji-toggle className={TOOL} onClick={() => setShowEmoji(s => !s)}><Smile className="w-3.5 h-3.5" />Emoji</button>
      <button type="button" className={TOOL} onClick={onInsertShortLink}><Link2 className="w-3.5 h-3.5" />Short link</button>
      <button type="button" disabled={uploading} className={TOOL} onClick={onPickImageTextual}>
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}Image as short link
      </button>
    </div>
  )

  return (
    <div className={embedded ? 'space-y-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" />
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Name</label>
          <input
            className="w-full px-4 py-2 border border-border-default border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
            value={value.name}
            onChange={e => onChange({ ...value, name: e.target.value })}
          />
        </div>

        {value.channel === 'email' && (
          <>
            <div>
              <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Subject</label>
              <input
                className="w-full px-4 py-2 border border-border-default border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                value={value.subject ?? ''}
                onChange={e => onChange({ ...value, subject: e.target.value })}
                placeholder="e.g. Order #{{order_number}} confirmed"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Message</label>
              {value.blocks_format === 'email-blocks' ? (
                // Block-built emails (imported from campaigns) stay in the block builder; body keeps the rendered HTML.
                <EmailBlockBuilder
                  extraVariables={composerVars}
                  blocks={(value.blocks as any)?.blocks ?? []}
                  onChange={b => onChange({ ...value, blocks: { blocks: b }, body: renderBlocks(b), blocks_format: 'email-blocks' })}
                />
              ) : (
                <EmailComposer
                  value={typeof value.body === 'string' ? value.body : ''}
                  onChange={html => onChange({ ...value, body: html, blocks: html, blocks_format: 'tiptap-html' })}
                  minHeight={360}
                  ctaHref={kind ? '{ctaUrl}' : '{storeUrl}'}
                  extraVariables={composerVars}
                />
              )}
              {kind && <div className="mt-2"><CampaignVariables kind={kind} channel="email" text={kindText} /></div>}
              <p className="mt-1 text-xs text-foreground-secondary">
                Tokens like <code>{'{customer_first_name}'}</code> are replaced with the actual customer details when the email is sent.
              </p>
            </div>
          </>
        )}

        {value.channel === 'sms' && (
          <div className="relative">
            <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Body</label>
            <textarea
              ref={textRef}
              className="w-full px-4 py-2 border border-border-default border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm font-mono"
              rows={6}
              value={value.body}
              onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'sms-text' })}
            />
                {toolbar}
            {emojiPanel}
            {smsStats && (
              <p className="mt-1 text-xs text-foreground-secondary">
                {smsStats.length}/{smsStats.limit} chars · {smsStats.encoding} · {smsStats.segments} segment{smsStats.segments === 1 ? '' : 's'}
                {smsStats.encoding === 'UCS-2' && ' · emoji flips to UCS-2 (DLT may need re-registration)'}
              </p>
            )}
            {kind && <div className="mt-2"><CampaignVariables kind={kind} channel="sms" text={kindText} /></div>}
          </div>
        )}

        {value.channel === 'whatsapp' && (() => {
          const waBlocks = (value.blocks as WaBlocks | undefined) ?? {}
          const cards = waBlocks.carousel?.cards ?? []
          const buttons = waBlocks.buttons ?? []
          const isApproved = value.approval_status === 'approved'
          const mediaLocked = isApproved && !!value.media_type

          const setBlocks = (patch: Partial<WaBlocks>) =>
            onChange({ ...value, blocks: { ...waBlocks, ...patch }, blocks_format: 'wa-content' })

          const setCards = (next: WaCarouselCard[]) => setBlocks({ carousel: { cards: next } })
          const addCard = () => setCards([...cards, { title: '', body: '', buttons: [] }])
          const removeCard = (i: number) => setCards(cards.filter((_, idx) => idx !== i))
          const updateCard = (i: number, patch: Partial<WaCarouselCard>) =>
            setCards(cards.map((c, idx) => idx === i ? { ...c, ...patch } : c))

          const setButtons = (next: WaButton[]) => setBlocks({ buttons: next })
          const addButton = () => setButtons([...buttons, { type: 'quick_reply', label: '' }])
          const removeButton = (i: number) => setButtons(buttons.filter((_, idx) => idx !== i))
          const updateButton = (i: number, patch: Partial<WaButton>) =>
            setButtons(buttons.map((b, idx) => idx === i ? { ...b, ...patch } : b))

          const onPickCardMedia = async (i: number) => {
            const file = await pickFile()
            if (!file) return
            const url = await uploadFile(file)
            if (url) updateCard(i, { media_url: url })
          }

          const onPickHeaderMedia = async () => {
            if (mediaLocked) {
              showToast(`Header media type is locked to '${value.media_type}' after approval — you can swap the file, not the type.`, 'info')
            }
            const file = await pickFile()
            if (!file) return
            const url = await uploadFile(file)
            if (!url) return
            const types = { ...(waBlocks.types ?? {}), 'twilio/media': { body: value.body, media: [url] } }
            onChange({ ...value, blocks: { ...waBlocks, types }, blocks_format: 'wa-content', media_type: value.media_type ?? 'image' })
          }

          async function onSubmitForApproval() {
            const ok = await confirm({
              title: 'Submit to Meta for approval',
              message: `"${value.name || value.slug}" (${(value.meta_category ?? 'UTILITY').toLowerCase()}) will be saved and sent to Meta for review — usually minutes, up to 24 hours.\n\nUntil it's approved, customers keep receiving the currently approved version.`,
              confirmLabel: 'Save & submit',
            })
            if (!ok) return
            setSubmitting(true)
            try {
              const saved = await onSave(true)
              if (!saved?.id) return
              const r = await fetch(`${apiBase}/wa/submit-approval`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ templateId: saved.id, category: saved.meta_category ?? 'UTILITY' }),
              })
              const data = await r.json().catch(() => ({}))
              if (!r.ok) { showToast(data?.message || data?.error || `Submit failed (HTTP ${r.status})`, 'error'); return }
              onChange({ ...saved, approval_status: data.status ?? 'pending', approval_reason: null, needs_resubmission: false })
              showToast(`Submitted to Meta as ${data.name}. Status updates automatically.`, 'success')
            } finally { setSubmitting(false) }
          }

          async function onReCheckApproval() {
            setSubmitting(true)
            try {
              const r = await fetch(`${apiBase}/wa/sync-approval`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
              if (!r.ok) { showToast(`Re-check failed (HTTP ${r.status})`, 'error'); return }
              const t = await fetch(`${apiBase}/${value.channel}/${encodeURIComponent(value.slug)}`).then(x => x.ok ? x.json() : null)
              if (t) onChange(toEditorTemplate(t))
              showToast('Approval status refreshed.', 'success')
            } finally { setSubmitting(false) }
          }

          const vars = [...new Set([...(value.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => m[1]))].sort((x, y) => +x - +y)
          const samples = waBlocks.variables ?? {}

          return (
            <>
              <div>
                <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Meta category</label>
                <AdminSelect
                  value={value.meta_category ?? 'UTILITY'}
                  onChange={v => onChange({ ...value, meta_category: v })}
                  options={[{ value: 'MARKETING', label: 'Marketing' }, { value: 'UTILITY', label: 'Utility' }, { value: 'AUTHENTICATION', label: 'Authentication' }]}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">
                  Header media type {mediaLocked && <span className="text-xs text-foreground-muted">(locked after approval)</span>}
                </label>
                <div className="flex gap-2 items-center">
                  <AdminSelect
                    className="w-48"
                    disabled={mediaLocked}
                    value={value.media_type ?? ''}
                    onChange={v => onChange({ ...value, media_type: v || null })}
                    options={[{ value: '', label: 'None' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'document', label: 'Document' }]}
                  />
                  {value.media_type && (
                    <button type="button" disabled={uploading} className={`${TOOL} text-xs`} onClick={onPickHeaderMedia}>
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}Upload header media
                    </button>
                  )}
                </div>
                {(waBlocks.types as any)?.['twilio/media']?.media?.[0] && (
                  <p className="mt-1 text-xs text-foreground-secondary truncate">
                    Current: {(waBlocks.types as any)['twilio/media'].media[0]}
                  </p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-1.5">Body (use {'{{1}}'}, {'{{2}}'} … placeholders)</label>
                <textarea
                  ref={textRef}
                  className="w-full px-4 py-2 border border-border-default border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm font-mono"
                  rows={6}
                  value={value.body}
                  onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'wa-content' })}
                />
                {toolbar}
                {emojiPanel}
              </div>

              <div className="border border-border-default rounded-lg p-3 bg-surface-elevated">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">Action buttons ({buttons.length}/3)</span>
                  <button type="button" disabled={buttons.length >= 3} className="px-2 py-1 text-xs border border-border-default rounded-lg hover:bg-surface-secondary disabled:opacity-50" onClick={addButton}>+ Add button</button>
                </div>
                <p className="text-xs text-foreground-muted mb-2">Shown as tappable chips below the WhatsApp message body.</p>
                <div className="space-y-2">
                  {buttons.map((btn, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 border border-border-default rounded-lg p-2 bg-surface-secondary">
                      <AdminSelect
                        compact
                        className="w-36"
                        value={btn.type}
                        onChange={v => updateButton(i, { type: v as WaButton['type'], value: '' })}
                        options={[{ value: 'quick_reply', label: 'Quick reply' }, { value: 'url', label: 'Visit URL' }, { value: 'phone', label: 'Call phone' }]}
                      />
                      <input
                        className="border border-border-default rounded-lg px-2 py-1 text-xs flex-1 min-w-[8rem]"
                        placeholder="Label (max 25 chars)"
                        maxLength={25}
                        value={btn.label}
                        onChange={e => updateButton(i, { label: e.target.value })}
                      />
                      {btn.type !== 'quick_reply' && (
                        <input
                          className="border border-border-default rounded-lg px-2 py-1 text-xs flex-1 min-w-[10rem]"
                          placeholder={btn.type === 'url' ? 'https://… (or {{1}})' : '+911234567890'}
                          value={btn.value ?? ''}
                          onChange={e => updateButton(i, { value: e.target.value })}
                        />
                      )}
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeButton(i)}>remove</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-border-default rounded-lg p-3 bg-surface-elevated">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">Carousel cards ({cards.length}/10)</span>
                  <button type="button" disabled={cards.length >= 10} className="px-2 py-1 text-xs border border-border-default rounded-lg hover:bg-surface-secondary disabled:opacity-50" onClick={addCard}>+ Add card</button>
                </div>
                {cards.length === 0 && <p className="text-xs text-foreground-muted">No cards yet. Add 1–10 to turn this into a carousel template.</p>}
                <div className="space-y-3">
                  {cards.map((card, i) => (
                    <div key={i} className="border border-border-default rounded-lg p-2 bg-surface-secondary relative">
                      <button type="button" className="absolute top-1 right-1 text-xs text-red-600 hover:underline" onClick={() => removeCard(i)}>remove</button>
                      <div className="text-xs text-foreground-secondary mb-1">Card {i + 1}</div>
                      <input className="w-full border border-border-default rounded-lg px-2 py-1 text-sm mb-1" placeholder="Title" value={card.title ?? ''} onChange={e => updateCard(i, { title: e.target.value })} />
                      <textarea className="w-full border border-border-default rounded-lg px-2 py-1 text-sm font-mono" rows={2} placeholder="Body — use {{1}}, {{2}} …" value={card.body ?? ''} onChange={e => updateCard(i, { body: e.target.value })} />
                      <div className="flex items-center gap-2 mt-1">
                        <button type="button" disabled={uploading} className={`${TOOL} text-xs`} onClick={() => onPickCardMedia(i)}>
                          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : card.media_url ? <RefreshCw className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
                          {card.media_url ? 'Replace media' : 'Add media'}
                        </button>
                        {card.media_url && <span className="text-xs text-foreground-secondary truncate flex-1">{card.media_url}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {vars.length > 0 && (
                <div className="border border-border-default rounded-lg p-3 bg-surface-elevated">
                  <div className="text-sm font-medium text-foreground mb-1">Sample values for Meta review</div>
                  <p className="text-xs text-foreground-muted mb-2">Meta checks the template with these examples. They are never sent to customers.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {vars.map(v => (
                      <label key={v} className="flex items-center gap-2 text-xs">
                        <code className="shrink-0 text-foreground-secondary">{`{{${v}}}`}</code>
                        <input
                          className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs"
                          placeholder="Auto-filled if empty"
                          value={samples[v] ?? ''}
                          onChange={e => setBlocks({ variables: { ...samples, [v]: e.target.value } })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="border border-border-default rounded-lg p-3 bg-surface-elevated space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground mr-auto">Meta approval</span>
                  <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                    value.approval_status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    : value.approval_status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                    : value.approval_status === 'pending' || value.approval_status === 'received' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                    : 'bg-surface-secondary text-foreground-muted'
                  }`}>{value.approval_status === 'received' ? 'pending' : value.approval_status || 'unsubmitted'}</span>
                  <button type="button" disabled={submitting || !value.slug} className={`${TOOL} text-xs`} onClick={onSubmitForApproval}>
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save &amp; submit to Meta
                  </button>
                  <button type="button" disabled={submitting || !value.id} className={`${TOOL} text-xs`} onClick={onReCheckApproval}>
                    <RefreshCw className="w-3.5 h-3.5" />Re-check
                  </button>
                </div>
                {value.needs_resubmission && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">You have saved changes Meta hasn&apos;t reviewed. Customers still receive the approved version until you submit and it&apos;s approved.</p>
                )}
                {(value.approval_status === 'pending' || value.approval_status === 'received') && (
                  <p className="text-xs text-foreground-muted">Waiting for Meta — checked automatically every 10 minutes. Customers receive the previously approved version meanwhile.</p>
                )}
                {value.approval_status === 'rejected' && (
                  <p className="text-xs text-red-700 dark:text-red-300"><b>Rejected by Meta:</b> {value.approval_reason || 'no reason given'}. Edit the text and submit again.</p>
                )}
              </div>
            </>
          )
        })()}

        {embedded ? (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onSave(true)} disabled={saving} className="px-5 h-control bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Save template'}
            </button>
            <span className="text-[11px] text-foreground-muted">Saved to the Templates library — the same template everywhere it&apos;s used.</span>
          </div>
        ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => onSave(false)} disabled={saving} className="px-5 h-control bg-surface border border-border-default border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-semibold transition-colors text-sm disabled:opacity-60">Save draft</button>
          <button type="button" onClick={() => onSave(true)} disabled={saving} className="px-6 h-control bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm disabled:opacity-60">Publish</button>
          {value.channel === 'email' && <button type="button" onClick={runPreview} disabled={previewing} className="px-5 h-control bg-surface border border-border-default border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-semibold transition-colors text-sm disabled:opacity-60">Preview</button>}
        </div>
        )}
      </div>

      {!embedded && (
      <div className="bg-surface-secondary/50 rounded-lg border border-border-default p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Preview</div>
          {value.channel === 'email' && <button type="button" onClick={runPreview} disabled={previewing || !value.slug} className="text-xs px-3 py-1.5 bg-surface border border-border-default border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors disabled:opacity-60">
            {previewing ? 'Rendering…' : 'Render with sample data'}
          </button>}
        </div>
        {value.channel !== 'email' ? (() => {
          // SMS / WhatsApp: live handset preview of what's being edited (buttons, carousel, media included).
          const wb = (value.blocks as WaBlocks | undefined) ?? {}
          return (
            <PhonePreview
              channel={value.channel}
              body={value.body}
              vars={value.channel === 'whatsapp' ? wb.variables ?? {} : {}}
              headerMedia={value.channel === 'whatsapp' ? (wb.types as any)?.['twilio/media']?.media?.[0] ?? null : null}
              buttons={value.channel === 'whatsapp' ? wb.buttons ?? [] : []}
              cards={value.channel === 'whatsapp' ? wb.carousel?.cards ?? [] : []}
            />
          )
        })() : (
          <>
            {!preview && <p className="text-sm text-foreground-muted">Save first, then render to see the message as customers get it.</p>}
            {preview?.subject && <div className="font-semibold mb-2">{preview.subject}</div>}
            {preview?.body && <iframe title="Email preview" srcDoc={preview.body} sandbox="" className="w-full bg-surface-elevated border border-border-default rounded-lg" style={{ minHeight: 520 }} />}
          </>
        )}
        {preview?.missing && preview.missing.length > 0 && (
          <p className="mt-3 text-xs text-foreground-secondary">Sample values used for: {preview.missing.join(', ')}</p>
        )}
      </div>
      )}
    </div>
  )
}
