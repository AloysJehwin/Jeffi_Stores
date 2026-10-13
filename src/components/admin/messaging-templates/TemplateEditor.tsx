'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect, useMemo, useRef, useState } from 'react'

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
  approval_status?: string | null
}

type Props = {
  value: EditorTemplate
  apiBase: string // e.g. /api/admin/messaging-templates or /api/ecom/svc/messaging
  assetsBase?: string // optional override; defaults to `${apiBase}/assets/upload`
  shortLinksBase?: string // optional override; defaults to `${apiBase}/short-links`
  onChange: (t: EditorTemplate) => void
  onSave: (publish: boolean) => Promise<void>
  saving?: boolean
}

const SMS_GSM_LIMIT = 160
const SMS_UCS2_LIMIT = 70
const hasEmoji = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)

const QUICK_EMOJI = ['🎉','✅','📦','🚚','💰','⚡','🎁','🔥','🏆','⏰','👋','🛒','💬','⭐','🙏']

export default function TemplateEditor({ value, apiBase, assetsBase, shortLinksBase, onChange, onSave, saving }: Props) {
  const [preview, setPreview] = useState<{ subject?: string | null; body?: string; missing?: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const uploadUrl = assetsBase ?? `${apiBase}/assets/upload`
  const shortUrl = shortLinksBase ?? `${apiBase}/short-links`

  const email = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: value.channel === 'email' ? (value.blocks as any) ?? value.body : '',
    editable: value.channel === 'email',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (value.channel !== 'email') return
      onChange({ ...value, blocks: editor.getJSON(), blocks_format: 'tiptap', body: editor.getText() })
    },
  })

  useEffect(() => {
    if (value.channel === 'email' && email && value.blocks) {
      const current = email.getJSON()
      if (JSON.stringify(current) !== JSON.stringify(value.blocks)) email.commands.setContent(value.blocks as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.id])

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

  async function onPickImageEmail() {
    const file = await pickFile()
    if (!file) return
    const url = await uploadFile(file)
    if (url) email?.chain().focus().insertContent(`<img src="${url}" alt="" />`).run()
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
            <div className="border rounded">
              <div className="flex flex-wrap gap-1 border-b p-2 text-sm">
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleBold().run()}><b>B</b></button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded italic" onClick={() => email?.chain().focus().toggleItalic().run()}>I</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleBulletList().run()}>• List</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => {
                  const url = prompt('Link URL')
                  if (url) email?.chain().focus().setLink({ href: url }).run()
                }}>Link</button>
                <button type="button" disabled={uploading} className="px-2 py-1 hover:bg-gray-100 rounded disabled:opacity-50" onClick={onPickImageEmail}>
                  {uploading ? '⏳ Uploading…' : '🖼️ Image'}
                </button>
              </div>
              <EditorContent editor={email} className="prose max-w-none p-3 min-h-[320px]" />
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

        {value.channel === 'whatsapp' && (
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
            {value.approval_status && (
              <span className={`inline-block px-2 py-1 text-xs rounded ${
                value.approval_status === 'approved' ? 'bg-green-100 text-green-800'
                : value.approval_status === 'rejected' ? 'bg-red-100 text-red-800'
                : 'bg-yellow-100 text-yellow-800'
              }`}>
                Approval: {value.approval_status}
              </span>
            )}
          </>
        )}

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
