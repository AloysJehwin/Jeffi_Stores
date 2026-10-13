'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect, useMemo, useState } from 'react'

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
  apiBase: string // e.g. /api/admin/messaging-templates
  onChange: (t: EditorTemplate) => void
  onSave: (publish: boolean) => Promise<void>
  saving?: boolean
}

const SMS_GSM_LIMIT = 160
const SMS_UCS2_LIMIT = 70
const hasEmoji = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)

export default function TemplateEditor({ value, apiBase, onChange, onSave, saving }: Props) {
  const [preview, setPreview] = useState<{ subject?: string | null; body?: string; missing?: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)

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
      // sync only when switching templates — not on every keystroke
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              <div className="flex gap-1 border-b p-2 text-sm">
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleBold().run()}><b>B</b></button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded italic" onClick={() => email?.chain().focus().toggleItalic().run()}>I</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => email?.chain().focus().toggleBulletList().run()}>• List</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => {
                  const url = prompt('Link URL')
                  if (url) email?.chain().focus().setLink({ href: url }).run()
                }}>Link</button>
                <button type="button" className="px-2 py-1 hover:bg-gray-100 rounded" onClick={() => {
                  const src = prompt('Image URL')
                  if (src) email?.chain().focus().insertContent(`<img src="${src}" />`).run()
                }}>Image</button>
              </div>
              <EditorContent editor={email} className="prose max-w-none p-3 min-h-[320px]" />
            </div>
          </>
        )}

        {value.channel === 'sms' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
            <textarea
              className="w-full border rounded px-3 py-2 font-mono text-sm"
              rows={6}
              value={value.body}
              onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'sms-text' })}
            />
            {smsStats && (
              <p className="mt-1 text-xs text-gray-500">
                {smsStats.length}/{smsStats.limit} chars · {smsStats.encoding} · {smsStats.segments} segment{smsStats.segments === 1 ? '' : 's'}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body (use {'{{1}}'}, {'{{2}}'} … placeholders)</label>
              <textarea
                className="w-full border rounded px-3 py-2 font-mono text-sm"
                rows={6}
                value={value.body}
                onChange={e => onChange({ ...value, body: e.target.value, blocks_format: 'wa-content' })}
              />
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
