'use client'

import { useMemo, useRef, useState } from 'react'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'

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
  onSave: (publish: boolean) => Promise<void>
  saving?: boolean
}

const SMS_GSM_LIMIT = 160
const SMS_UCS2_LIMIT = 70
const hasEmoji = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)

const QUICK_EMOJI = ['🎉','✅','📦','🚚','💰','⚡','🎁','🔥','🏆','⏰','👋','🛒','💬','⭐','🙏']

type WaBlocks = {
  types?: Record<string, any>
  variables?: Record<string, string>
  buttons?: WaButton[]
  carousel?: { cards: WaCarouselCard[] }
}

export default function TemplateEditor({ value, apiBase, assetsBase, shortLinksBase, onChange, onSave, saving }: Props) {
  const [preview, setPreview] = useState<{ subject?: string | null; body?: string; missing?: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
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
        alert(err?.error || `Upload failed (HTTP ${r.status})`)
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
    const dest = prompt('Destination URL (where the short link redirects)')
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

  const emojiPanel = showEmoji && (
    <div className="absolute z-10 mt-1 p-2 bg-white border rounded shadow grid grid-cols-5 gap-1">
      {QUICK_EMOJI.map(e => (
        <button key={e} type="button" className="px-2 py-1 hover:bg-gray-100 rounded text-lg"
          onClick={() => { insertAtCursor(e); setShowEmoji(false) }}>{e}</button>
      ))}
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" />
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={value.name}
            onChange={e => onChange({ ...value, name: e.target.value })}
          />
        </div>

        {value.channel === 'email' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                className="w-full border rounded px-3 py-2"
                value={value.subject ?? ''}
                onChange={e => onChange({ ...value, subject: e.target.value })}
                placeholder="e.g. Order #{{order_number}} confirmed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <EmailComposer
                value={typeof value.body === 'string' ? value.body : ''}
                onChange={html => onChange({ ...value, body: html, blocks: html, blocks_format: 'tiptap-html' })}
                minHeight={360}
                ctaHref="{storeUrl}"
              />
              <p className="mt-1 text-xs text-gray-500">
                Tokens like <code>{'{customer_first_name}'}</code> are replaced with the actual customer details when the email is sent.
              </p>
            </div>
          </>
        )}

        {value.channel === 'sms' && (
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
            <textarea
              ref={textRef}
              className="w-full border rounded px-3 py-2 font-mono text-sm"
              rows={6}
              value={value.body}
              onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'sms-text' })}
            />
            <div className="flex flex-wrap gap-1 mt-1 text-xs">
              <button type="button" className="px-2 py-1 border rounded hover:bg-gray-100" onClick={() => setShowEmoji(s => !s)}>😊 Emoji</button>
              <button type="button" className="px-2 py-1 border rounded hover:bg-gray-100" onClick={onInsertShortLink}>🔗 Short link</button>
              <button type="button" disabled={uploading} className="px-2 py-1 border rounded hover:bg-gray-100 disabled:opacity-50" onClick={onPickImageTextual}>
                {uploading ? '⏳' : '🖼️ Image → short link'}
              </button>
            </div>
            {emojiPanel}
            {smsStats && (
              <p className="mt-1 text-xs text-gray-500">
                {smsStats.length}/{smsStats.limit} chars · {smsStats.encoding} · {smsStats.segments} segment{smsStats.segments === 1 ? '' : 's'}
                {smsStats.encoding === 'UCS-2' && ' · emoji flips to UCS-2 (DLT may need re-registration)'}
              </p>
            )}
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
              alert(`Header media type is locked to '${value.media_type}' after approval. You can swap the URL but not the type.`)
            }
            const file = await pickFile()
            if (!file) return
            const url = await uploadFile(file)
            if (!url) return
            const types = { ...(waBlocks.types ?? {}), 'twilio/media': { body: value.body, media: [url] } }
            onChange({ ...value, blocks: { ...waBlocks, types }, blocks_format: 'wa-content', media_type: value.media_type ?? 'image' })
          }

          async function onSubmitForApproval() {
            if (!value.id) { alert('Save the template first.'); return }
            const name = prompt('Template name (snake_case) submitted to Meta', value.slug.replace(/[^a-z0-9_]/gi, '_').toLowerCase())
            if (!name) return
            setSubmitting(true)
            try {
              const r = await fetch(`${apiBase}/wa/submit-approval`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ templateId: value.id, locale: 'en', name, category: value.meta_category ?? 'UTILITY' }),
              })
              const data = await r.json().catch(() => ({}))
              if (!r.ok) { alert(data?.error || `Submit failed (HTTP ${r.status})`); return }
              onChange({ ...value, approval_status: data.status ?? 'pending' })
            } finally { setSubmitting(false) }
          }

          async function onReCheckApproval() {
            setSubmitting(true)
            try {
              const r = await fetch(`${apiBase}/wa/sync-approval`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
              })
              if (r.ok) alert('Approval status re-synced. Reload to see updates.')
            } finally { setSubmitting(false) }
          }

          return (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meta category</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={value.meta_category ?? 'UTILITY'}
                  onChange={e => onChange({ ...value, meta_category: e.target.value })}
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Header media type {mediaLocked && <span className="text-xs text-amber-700">(locked after approval)</span>}
                </label>
                <div className="flex gap-2 items-center">
                  <select
                    className="border rounded px-3 py-2 text-sm"
                    disabled={mediaLocked}
                    value={value.media_type ?? ''}
                    onChange={e => onChange({ ...value, media_type: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="document">Document</option>
                  </select>
                  {value.media_type && (
                    <button type="button" disabled={uploading} className="px-2 py-1 border rounded text-xs hover:bg-gray-100" onClick={onPickHeaderMedia}>
                      {uploading ? '⏳' : '🖼️ Upload header media'}
                    </button>
                  )}
                </div>
                {(waBlocks.types as any)?.['twilio/media']?.media?.[0] && (
                  <p className="mt-1 text-xs text-gray-500 truncate">
                    Current: {(waBlocks.types as any)['twilio/media'].media[0]}
                  </p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Body (use {'{{1}}'}, {'{{2}}'} … placeholders)</label>
                <textarea
                  ref={textRef}
                  className="w-full border rounded px-3 py-2 font-mono text-sm"
                  rows={6}
                  value={value.body}
                  onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'wa-content' })}
                />
                <div className="flex flex-wrap gap-1 mt-1 text-xs">
                  <button type="button" className="px-2 py-1 border rounded hover:bg-gray-100" onClick={() => setShowEmoji(s => !s)}>😊 Emoji</button>
                  <button type="button" className="px-2 py-1 border rounded hover:bg-gray-100" onClick={onInsertShortLink}>🔗 Short link</button>
                  <button type="button" disabled={uploading} className="px-2 py-1 border rounded hover:bg-gray-100 disabled:opacity-50" onClick={onPickImageTextual}>
                    {uploading ? '⏳' : '🖼️ Image → short link'}
                  </button>
                </div>
                {emojiPanel}
              </div>

              <div className="border rounded p-3 bg-white">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">Action buttons ({buttons.length}/3)</span>
                  <button type="button" disabled={buttons.length >= 3} className="px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50" onClick={addButton}>+ Add button</button>
                </div>
                <p className="text-xs text-gray-400 mb-2">Shown as tappable chips below the WhatsApp message body.</p>
                <div className="space-y-2">
                  {buttons.map((btn, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 border rounded p-2 bg-gray-50">
                      <select
                        className="border rounded px-2 py-1 text-xs"
                        value={btn.type}
                        onChange={e => updateButton(i, { type: e.target.value as WaButton['type'], value: '' })}
                      >
                        <option value="quick_reply">Quick reply</option>
                        <option value="url">Visit URL</option>
                        <option value="phone">Call phone</option>
                      </select>
                      <input
                        className="border rounded px-2 py-1 text-xs flex-1 min-w-[8rem]"
                        placeholder="Label (max 25 chars)"
                        maxLength={25}
                        value={btn.label}
                        onChange={e => updateButton(i, { label: e.target.value })}
                      />
                      {btn.type !== 'quick_reply' && (
                        <input
                          className="border rounded px-2 py-1 text-xs flex-1 min-w-[10rem]"
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

              <div className="border rounded p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Carousel cards ({cards.length}/10)</span>
                  <button type="button" disabled={cards.length >= 10} className="px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50" onClick={addCard}>+ Add card</button>
                </div>
                {cards.length === 0 && <p className="text-xs text-gray-400">No cards yet. Add 1–10 to turn this into a carousel template.</p>}
                <div className="space-y-3">
                  {cards.map((card, i) => (
                    <div key={i} className="border rounded p-2 bg-gray-50 relative">
                      <button type="button" className="absolute top-1 right-1 text-xs text-red-600 hover:underline" onClick={() => removeCard(i)}>remove</button>
                      <div className="text-xs text-gray-500 mb-1">Card {i + 1}</div>
                      <input className="w-full border rounded px-2 py-1 text-sm mb-1" placeholder="Title" value={card.title ?? ''} onChange={e => updateCard(i, { title: e.target.value })} />
                      <textarea className="w-full border rounded px-2 py-1 text-sm font-mono" rows={2} placeholder="Body — use {{1}}, {{2}} …" value={card.body ?? ''} onChange={e => updateCard(i, { body: e.target.value })} />
                      <div className="flex items-center gap-2 mt-1">
                        <button type="button" disabled={uploading} className="px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50" onClick={() => onPickCardMedia(i)}>
                          {uploading ? '⏳' : card.media_url ? '🔄 Replace media' : '🖼️ Add media'}
                        </button>
                        {card.media_url && <span className="text-xs text-gray-500 truncate flex-1">{card.media_url}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {value.approval_status && (
                  <span className={`inline-block px-2 py-1 text-xs rounded ${
                    value.approval_status === 'approved' ? 'bg-green-100 text-green-800'
                    : value.approval_status === 'rejected' ? 'bg-red-100 text-red-800'
                    : value.approval_status === 'paused' ? 'bg-orange-100 text-orange-800'
                    : value.approval_status === 'disabled' ? 'bg-gray-200 text-gray-700'
                    : 'bg-yellow-100 text-yellow-800'
                  }`}>Approval: {value.approval_status}</span>
                )}
                <button type="button" disabled={submitting || !value.id} className="px-3 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50" onClick={onSubmitForApproval}>
                  {submitting ? '…' : 'Submit for approval'}
                </button>
                <button type="button" disabled={submitting} className="px-3 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50" onClick={onReCheckApproval}>
                  Re-check
                </button>
              </div>
              {value.approval_status === 'rejected' && value.approval_reason && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  <b>Meta rejection:</b> {value.approval_reason}
                </p>
              )}
            </>
          )
        })()}

        <div className="flex gap-2">
          <button type="button" onClick={() => onSave(false)} disabled={saving} className="px-4 py-2 border rounded">Save draft</button>
          <button type="button" onClick={() => onSave(true)} disabled={saving} className="px-4 py-2 bg-black text-white rounded">Publish</button>
          <button type="button" onClick={runPreview} disabled={previewing} className="px-4 py-2 border rounded">Preview</button>
        </div>
      </div>

      <div className="border rounded p-4 bg-gray-50">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Preview</div>
        {!preview && <p className="text-sm text-gray-400">Click Preview to render with sample data.</p>}
        {preview?.subject && <div className="font-semibold mb-2">{preview.subject}</div>}
        {preview?.body && (
          value.channel === 'email'
            ? <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: preview.body }} />
            : <pre className="whitespace-pre-wrap font-mono text-sm">{preview.body}</pre>
        )}
        {preview?.missing && preview.missing.length > 0 && (
          <p className="mt-3 text-xs text-amber-700">Missing variables: {preview.missing.join(', ')}</p>
        )}
      </div>
    </div>
  )
}
