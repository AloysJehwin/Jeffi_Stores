'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Plus } from 'lucide-react'
import { Tabs, TabAction } from '@/components/admin/channels/ui'
import TemplateEditor, {
  toEditorTemplate,
  type Channel,
  type EditorTemplate,
} from '@/components/admin/messaging-templates/TemplateEditor'
import { PageHeader, fieldInputCls } from '@/components/admin/kit'
import { useMessagingChannels } from '@/hooks/useStoreFlags'
import { PAGES, pagesOf, scenarioOf } from '@/lib/messaging/placements'

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
  source?: 'tenant' | 'platform'
  updated_at?: string
  tags?: string[]
}

// Where the template is offered ("Show on"), e.g. "Order page · Processing delay".
const showOn = (tags?: string[]) =>
  pagesOf(tags).map(p => [PAGES[p].label, p === 'order' ? scenarioOf('order', tags)?.label : null].filter(Boolean).join(' · '))

function parseChannel(v: string | null, shown: Channel[]): Channel {
  return (shown as string[]).includes(v || '') ? (v as Channel) : 'email'
}

export default function MessagingTemplatesClient() {
  const router = useRouter()
  const sp = useSearchParams()

  // Site Controls' switches: an off channel has no tab, and ?channel= for it falls back to email.
  const on = useMessagingChannels()
  const shown = CHANNELS.filter(c => c === 'email' || on[c])
  const channel = parseChannel(sp.get('channel'), shown)
  const slug = sp.get('slug') // deep-link target slug
  const q = sp.get('q') ?? ''

  const [items, setItems] = useState<ListItem[]>([])
  const [selected, setSelected] = useState<EditorTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState(q)
  const { showToast } = useToast()

  const updateUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [router, sp]
  )

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

  useEffect(() => {
    load()
  }, [load])

  // Deep-link: when a slug is in the URL, auto-open the matching template.
  useEffect(() => {
    if (!slug) return
    if (selected?.slug === slug && selected.channel === channel) return
    fetch(`${API}/${channel}/${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(t => {
        if (t) setSelected(toEditorTemplate(t))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, channel])

  async function open(it: ListItem) {
    updateUrl({ slug: it.slug })
  }

  function createNew() {
    setSelected({
      slug: '',
      channel,
      name: '',
      subject: '',
      body: '',
      blocks_format: channel === 'email' ? 'tiptap' : channel === 'sms' ? 'sms-text' : 'wa-content',
    })
    updateUrl({ slug: null })
  }

  function closeEditor() {
    setSelected(null)
    updateUrl({ slug: null })
  }

  async function save(publish: boolean): Promise<EditorTemplate | null> {
    if (!selected) return null
    setSaving(true)
    try {
      const body = { ...selected, publish }
      const url = selected.id ? `${API}/${selected.id}` : API
      const method = selected.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const saved = toEditorTemplate(await res.json())
        setSelected(saved)
        showToast(publish ? 'Template published.' : 'Draft saved.', 'success')
        if (saved.slug) updateUrl({ slug: saved.slug })
        await load()
        return saved
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(`Save failed: ${err?.message || err?.error || res.status}`, 'error')
        return null
      }
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      i =>
        (i.name || '').toLowerCase().includes(needle) ||
        i.slug.toLowerCase().includes(needle) ||
        (i.category || '').toLowerCase().includes(needle)
    )
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

  const INPUT = fieldInputCls
  const counts = useMemo(
    () => ({
      tenant: items.filter(i => i.source === 'tenant').length,
      platform: items.filter(i => i.source !== 'tenant').length,
    }),
    [items]
  )
  const canUseScenarioFill = useCanWrite('templates')
  // New templates created from this admin page are platform-library drafts (source !== 'tenant' when
  // saved); editing an existing one looks up the row's source to split platform-tier vs tenant-tier
  // billing in the scenario-fill endpoint.
  const isPlatformLibrary = useMemo(() => {
    if (!selected) return true
    if (!selected.id) return true
    const match = items.find(i => i.id === selected.id)
    return match?.source !== 'tenant'
  }, [selected, items])

  return (
    <div className="p-4 sm:p-6 animate-fade-in">
      <div className="mb-5">
        <PageHeader
          title="Templates"
          description={`Standard ${shown.map(c => (c === 'email' ? 'email' : CHANNEL_LABEL[c])).join(' / ')} bodies ship with every store. Edit one to customise it for this tenant, or add your own.`}
        />
      </div>

      <div className="mb-5">
        <Tabs
          tabs={shown.map(c => ({
            id: c,
            label: (
              <>
                {CHANNEL_LABEL[c]}
                {channel === c && !loading && (
                  <span className="ml-1 text-xs text-foreground-muted tabular-nums">{items.length}</span>
                )}
              </>
            ),
          }))}
          value={channel}
          onChange={c => {
            updateUrl({ channel: c, slug: null })
            setSelected(null)
          }}
          actions={
            <>
              {!loading && items.length > 0 && (
                <span className="hidden sm:inline mr-2 text-xs text-foreground-muted whitespace-nowrap">
                  {counts.tenant} customised · {counts.platform} standard
                </span>
              )}
              <TabAction onClick={createNew} icon={<Plus className="w-4 h-4" />} label="New template" />
            </>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        <aside className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
          <div className="p-3 border-b border-border-default">
            <input
              className={INPUT}
              placeholder="Filter by name, slug, or category"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                updateUrl({ q: e.target.value || null })
              }}
            />
          </div>
          <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="px-4 py-3 border-b border-border-default animate-pulse"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="h-3.5 w-2/3 bg-surface-secondary rounded mb-2" />
                  <div className="h-3 w-1/3 bg-surface-secondary rounded opacity-60" />
                </div>
              ))}
            {!loading && filtered.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-foreground">No templates match</p>
                <p className="text-xs text-foreground-muted mt-1">
                  {query ? 'Try a different filter.' : 'Create one with “New template”.'}
                </p>
              </div>
            )}
            {!loading &&
              grouped.map(([cat, list]) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted bg-surface-secondary border-y border-border-default">
                    {cat}
                  </div>
                  <ul>
                    {list.map(it => {
                      const active = selected?.slug === it.slug && selected.channel === channel
                      return (
                        <li key={it.id}>
                          <button
                            onClick={() => open(it)}
                            className={`w-full text-left px-4 py-3 border-l-2 border-b border-b-border-default transition-colors ${
                              active
                                ? 'border-l-accent-500 bg-surface-secondary'
                                : 'border-l-transparent hover:bg-surface-secondary/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm text-foreground truncate">{it.name || it.slug}</span>
                              {it.source === 'tenant' ? (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-500/10 text-accent-600">
                                  Customised
                                </span>
                              ) : (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-secondary text-foreground-muted">
                                  Standard
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex gap-2 items-center text-xs text-foreground-muted">
                              <code className="truncate">{it.slug}</code>
                              {showOn(it.tags).map(l => (
                                <span key={l} className="shrink-0 px-1.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-700 dark:text-sky-400">
                                  {l}
                                </span>
                              ))}
                              {it.channel === 'whatsapp' && it.approval_status && (
                                <span
                                  className={`px-1.5 rounded text-[10px] font-medium ${
                                    it.approval_status === 'approved'
                                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                      : it.approval_status === 'rejected'
                                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {it.approval_status}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
          </div>
        </aside>

        <section className="bg-surface-elevated rounded-lg border border-border-default p-6">
          {!selected && (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-foreground">Select a template to edit</p>
              <p className="text-xs text-foreground-muted mt-1">
                Standard templates are shared by every store; saving creates this tenant’s own copy.
              </p>
            </div>
          )}
          {selected && (
            <>
              <div className="min-w-0 mb-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {CHANNEL_LABEL[selected.channel]}
                </div>
                <div className="font-semibold text-lg text-foreground truncate">
                  {selected.name || selected.slug || 'New template'}
                </div>
              </div>
              {!selected.id && (
                <div className="mb-5">
                  <label className="block text-sm font-semibold uppercase tracking-wide text-foreground mb-1.5">
                    Slug
                  </label>
                  <input
                    className={INPUT}
                    placeholder="e.g. order/confirmed"
                    value={selected.slug}
                    onChange={e => setSelected({ ...selected, slug: e.target.value })}
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Stable key the store code sends by. Lowercase, use / to group.
                  </p>
                </div>
              )}
              <TemplateEditor
                value={selected}
                apiBase={API}
                onChange={setSelected}
                onSave={save}
                saving={saving}
                onCancel={closeEditor}
                apiNote="API sends use the Messaging-API copy of this template (ecom console → Messaging), so edits to the store copy here do not change them."
                canUseScenarioFill={canUseScenarioFill}
                isPlatformLibrary={isPlatformLibrary}
                tenantContext={{ storeName: isPlatformLibrary ? 'The platform' : 'This store' }}
                canResetToPlatform={!isPlatformLibrary}
                metaActions={on.whatsapp}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
