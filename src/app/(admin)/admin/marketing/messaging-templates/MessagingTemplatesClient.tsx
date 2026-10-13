'use client'

import { useCallback, useEffect, useState } from 'react'
import TemplateEditor, { type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'

const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp']
const API = '/api/admin/messaging-templates'

type ListItem = {
  id: string
  slug: string
  channel: Channel
  name: string
  category?: string | null
  status?: string
  approval_status?: string | null
  updated_at?: string
}

export default function MessagingTemplatesClient() {
  const [channel, setChannel] = useState<Channel>('email')
  const [items, setItems] = useState<ListItem[]>([])
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}?channel=${channel}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [channel])

  useEffect(() => { load() }, [load])

  async function open(it: ListItem) {
    const res = await fetch(`${API}/${it.channel}/${encodeURIComponent(it.slug)}`)
    if (res.ok) setSelected(await res.json())
  }

  function createNew() {
    setSelected({ slug: '', channel, name: '', subject: '', body: '', blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content' })
  }

  async function save(publish: boolean) {
    if (!selected) return
    setSaving(true)
    try {
      const body = { ...selected, publish }
      const url = selected.id ? `${API}/${selected.id}` : API
      const method = selected.id ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) {
        const saved = await res.json()
        setSelected(saved)
        await load()
      } else {
        alert(`Save failed: ${res.status}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Messaging Templates</h1>
        <button onClick={createNew} className="px-4 py-2 bg-black text-white rounded">+ New</button>
      </div>

      <div className="flex gap-2 border-b mb-4">
        {CHANNELS.map(c => (
          <button
            key={c}
            onClick={() => { setChannel(c); setSelected(null) }}
            className={`px-4 py-2 border-b-2 ${channel === c ? 'border-black font-semibold' : 'border-transparent text-gray-500'}`}
          >
            {c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        <aside className="border rounded">
          {loading && <p className="p-3 text-sm text-gray-500">Loading…</p>}
          {!loading && items.length === 0 && <p className="p-3 text-sm text-gray-500">No templates yet.</p>}
          <ul className="divide-y">
            {items.map(it => (
              <li key={it.id}>
                <button
                  onClick={() => open(it)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${selected?.id === it.id ? 'bg-gray-100' : ''}`}
                >
                  <div className="font-medium">{it.name || it.slug}</div>
                  <div className="text-xs text-gray-500">{it.slug} · {it.category ?? '—'}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section>
          {!selected && <p className="text-gray-500">Select a template on the left, or create a new one.</p>}
          {selected && (
            <>
              {!selected.id && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slug (e.g. order/confirmed)</label>
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={selected.slug}
                    onChange={e => setSelected({ ...selected, slug: e.target.value })}
                  />
                </div>
              )}
              <TemplateEditor
                value={selected}
                apiBase={API}
                onChange={setSelected}
                onSave={save}
                saving={saving}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
