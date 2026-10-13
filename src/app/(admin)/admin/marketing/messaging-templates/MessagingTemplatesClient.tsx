'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TemplateEditor, { toEditorTemplate, type Channel, type EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'

const CHANNELS: Channel[] = ['email', 'sms', 'whatsapp']
const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }
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

function parseChannel(v: string | null): Channel {
  return (CHANNELS as string[]).includes(v || '') ? (v as Channel) : 'email'
}

export default function MessagingTemplatesClient() {
  const router = useRouter()
  const sp = useSearchParams()

  const channel = parseChannel(sp.get('channel'))
  const slug = sp.get('slug') // deep-link target slug
  const q = sp.get('q') ?? ''

  const [items, setItems] = useState<ListItem[]>([])
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState(q)

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k); else next.set(k, v)
    }
    router.replace(`?${next.toString()}`, { scroll: false })
  }, [router, sp])

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

  // Deep-link: when a slug is in the URL, auto-open the matching template.
  useEffect(() => {
    if (!slug) return
    if (selected?.slug === slug && selected.channel === channel) return
    fetch(`${API}/${channel}/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(t => { if (t) setSelected(toEditorTemplate(t)) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, channel])

  async function open(it: ListItem) {
    updateUrl({ slug: it.slug })
  }

  function createNew() {
    setSelected({ slug: '', channel, name: '', subject: '', body: '', blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content' })
    updateUrl({ slug: null })
  }

  function closeEditor() {
    setSelected(null)
    updateUrl({ slug: null })
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
        setSelected(toEditorTemplate(saved))
        if (saved?.slug) updateUrl({ slug: saved.slug })
        await load()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`Save failed: ${err?.error || res.status}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(i =>
      (i.name || '').toLowerCase().includes(needle)
      || i.slug.toLowerCase().includes(needle)
      || (i.category || '').toLowerCase().includes(needle))
  }, [items, query])

  const grouped = useMemo(() => {
    const map = new Map<string, ListItem[]>()
    for (const it of filtered) {
      const key = it.category || 'uncategorised'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Messaging Templates</h1>
          <p className="text-foreground-secondary mt-1 text-sm">
            Edit email / SMS / WhatsApp bodies the store sends. Changes isolate to this tenant.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={createNew} className="px-4 py-2 bg-black text-white rounded">+ New template</button>
        </div>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {CHANNELS.map(c => (
          <button
            key={c}
            onClick={() => { updateUrl({ channel: c, slug: null }); setSelected(null) }}
            className={`px-4 py-2 border-b-2 whitespace-nowrap ${channel === c ? 'border-black font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {CHANNEL_LABEL[c]}
            <span className="ml-2 text-xs text-gray-400">{channel === c ? items.length : ''}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <aside className="border rounded bg-white dark:bg-surface-elevated">
          <div className="p-2 border-b">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Filter by name, slug, or category"
              value={query}
              onChange={e => { setQuery(e.target.value); updateUrl({ q: e.target.value || null }) }}
            />
          </div>
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
            {loading && <p className="p-3 text-sm text-gray-500">Loading…</p>}
            {!loading && filtered.length === 0 && <p className="p-3 text-sm text-gray-500">No templates match.</p>}
            {grouped.map(([cat, list]) => (
              <div key={cat}>
                <div className="px-3 py-1 text-xs uppercase tracking-wide text-gray-400 bg-gray-50 dark:bg-surface">{cat}</div>
                <ul className="divide-y">
                  {list.map(it => (
                    <li key={it.id}>
                      <button
                        onClick={() => open(it)}
                        className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-surface ${selected?.slug === it.slug && selected.channel === channel ? 'bg-gray-100 dark:bg-surface' : ''}`}
                      >
                        <div className="font-medium text-sm">{it.name || it.slug}</div>
                        <div className="text-xs text-gray-500 flex gap-2 items-center">
                          <code>{it.slug}</code>
                          {it.channel === 'whatsapp' && it.approval_status && (
                            <span className={`px-1 rounded text-[10px] ${
                              it.approval_status === 'approved' ? 'bg-green-100 text-green-800'
                              : it.approval_status === 'rejected' ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                            }`}>{it.approval_status}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        <section className="border rounded bg-white dark:bg-surface-elevated p-4">
          {!selected && <p className="text-gray-500">Select a template on the left, or create a new one.</p>}
          {selected && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-gray-500">{CHANNEL_LABEL[selected.channel]}</div>
                  <div className="font-medium text-lg">{selected.name || selected.slug || 'New template'}</div>
                </div>
                <button onClick={closeEditor} className="text-sm text-gray-500 hover:text-gray-700">✕ Close</button>
              </div>
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
