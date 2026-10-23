'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import Toggle from '@/components/ui/Toggle'
import Select from '@/components/ui/Select'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, Empty, Section, api, btnGhost, btnPrimary, inputCls } from '@/components/admin/channels/ui'
import { PLATFORMS, PLATFORM_LABEL, type Platform, type Template } from './shared'

const lbl = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function Library() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const loadTemplates = useCallback(async () => {
    const r = await api<{ templates: Template[] }>('/api/admin/social/templates')
    setTemplates(r.ok ? (r.data.templates ?? []) : [])
  }, [])
  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  return (
    <div className="space-y-4">
      <Templates templates={templates} reload={loadTemplates} />
      <Rules templates={templates ?? []} />
    </div>
  )
}

function Templates({ templates, reload }: { templates: Template[] | null; reload: () => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function remove(id: string) {
    setBusy(id)
    const r = await api(`/api/admin/social/templates/${id}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Could not delete', 'error')
    reload()
  }

  return (
    <Section title="Caption templates" action={canWrite ? <IconButton icon={Plus} label="New template" onClick={() => setEditing('new')} /> : undefined}>
      <p className="text-xs text-foreground-muted mb-3">
        Placeholders: <span className="font-mono">{'{name} {price} {old_price} {url}'}</span> are filled from the product.
      </p>
      {editing && (
        <TemplateForm
          initial={editing === 'new' ? null : editing}
          onDone={saved => {
            setEditing(null)
            if (saved) reload()
          }}
        />
      )}
      {!templates ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !templates.length ? (
        <Empty msg="No templates yet." />
      ) : (
        <ul className="divide-y divide-border-default">
          {templates.map(t => (
            <li key={t.id} className="py-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-foreground-muted line-clamp-2 whitespace-pre-line">{t.caption}</p>
                {t.hashtags && <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{t.hashtags}</p>}
              </div>
              {canWrite && (
                <div className="flex gap-0.5">
                  <IconButton icon={Pencil} size="sm" label="Edit" onClick={() => setEditing(t)} />
                  <IconButton icon={Trash2} size="sm" variant="danger" label="Delete" busy={busy === t.id} onClick={() => remove(t.id)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function TemplateForm({ initial, onDone }: { initial: Template | null; onDone: (saved: boolean) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [caption, setCaption] = useState(initial?.caption ?? '')
  const [hashtags, setHashtags] = useState(initial?.hashtags ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const json = { name: name.trim(), caption: caption.trim(), hashtags: hashtags.trim() || null }
    const r = initial
      ? await api(`/api/admin/social/templates/${initial.id}`, { method: 'PATCH', json })
      : await api('/api/admin/social/templates', { method: 'POST', json })
    setSaving(false)
    if (!r.ok) return showToast(r.data.error || 'Could not save', 'error')
    onDone(true)
  }

  if (!canWrite) return null
  return (
    <div className="mb-4 rounded-lg bg-surface-secondary p-3 space-y-2">
      <div>
        <label className={lbl}>Name</label>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div>
        <label className={lbl}>Caption</label>
        <textarea rows={4} className={inputCls} value={caption} onChange={e => setCaption(e.target.value)} placeholder="New in: {name}, now {price}. {url}" />
      </div>
      <div>
        <label className={lbl}>Hashtags</label>
        <input className={inputCls} value={hashtags} onChange={e => setHashtags(e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className={btnGhost} onClick={() => onDone(false)}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={saving || !name.trim() || !caption.trim()} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

interface Rule {
  id: string
  trigger: 'new_product' | 'back_in_stock' | 'price_drop'
  platforms: Platform[]
  template_id: string | null
  min_drop_pct: number
  require_approval: boolean
  enabled: boolean
}

const TRIGGER_LABEL: Record<Rule['trigger'], string> = {
  new_product: 'New product',
  back_in_stock: 'Back in stock',
  price_drop: 'Price drop',
}
const RULE_PLATFORMS = PLATFORMS.filter(p => p !== 'ig_reel' && p !== 'youtube')

function Rules({ templates }: { templates: Template[] }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<{ rules: Rule[] }>('/api/admin/social/autopost')
    setRules(r.ok ? (r.data.rules ?? []) : [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function remove(id: string) {
    setBusy(id)
    const r = await api(`/api/admin/social/autopost/${id}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Could not delete', 'error')
    load()
  }

  async function toggle(rule: Rule) {
    setBusy(rule.id)
    const r = await api(`/api/admin/social/autopost/${rule.id}`, { method: 'PATCH', json: toBody({ ...rule, enabled: !rule.enabled }) })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Could not save', 'error')
    load()
  }

  return (
    <Section title="Auto-post rules" action={canWrite ? <IconButton icon={Plus} label="New rule" onClick={() => setEditing('new')} /> : undefined}>
      <p className="text-xs text-foreground-muted mb-3">
        Posts new products, items back in stock and price drops on their own. The first run after a rule is added only records the current catalogue and posts nothing, so existing products are not flooded out.
      </p>
      {editing && (
        <RuleForm
          initial={editing === 'new' ? null : editing}
          templates={templates}
          onDone={saved => {
            setEditing(null)
            if (saved) load()
          }}
        />
      )}
      {!rules ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !rules.length ? (
        <Empty msg="No rules yet." />
      ) : (
        <ul className="divide-y divide-border-default">
          {rules.map(r => (
            <li key={r.id} className="py-2 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium w-32">{TRIGGER_LABEL[r.trigger]}</span>
              <span className="text-sm text-foreground-secondary flex-1 min-w-0">
                {r.platforms.map(p => PLATFORM_LABEL[p] ?? p).join(', ')}
                {r.trigger === 'price_drop' ? `, at least ${r.min_drop_pct}% off` : ''}
                {r.template_id ? `, template ${templates.find(t => t.id === r.template_id)?.name ?? ''}` : ''}
              </span>
              {r.require_approval && <Badge tone="amber">needs approval</Badge>}
              {canWrite ? <Toggle size="sm" checked={r.enabled} disabled={busy === r.id} onChange={() => toggle(r)} label={r.enabled ? 'On' : 'Off'} /> : <Badge tone={r.enabled ? 'green' : 'muted'}>{r.enabled ? 'on' : 'off'}</Badge>}
              {canWrite && (
                <div className="flex gap-0.5">
                  <IconButton icon={Pencil} size="sm" label="Edit" onClick={() => setEditing(r)} />
                  <IconButton icon={Trash2} size="sm" variant="danger" label="Delete" busy={busy === r.id} onClick={() => remove(r.id)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const toBody = (r: Omit<Rule, 'id'>) => ({
  trigger: r.trigger,
  platforms: r.platforms,
  templateId: r.template_id || null,
  minDropPct: Number(r.min_drop_pct),
  requireApproval: r.require_approval,
  enabled: r.enabled,
})

function RuleForm({ initial, templates, onDone }: { initial: Rule | null; templates: Template[]; onDone: (saved: boolean) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [r, setR] = useState<Omit<Rule, 'id'>>(
    initial ?? { trigger: 'new_product', platforms: ['fb'], template_id: null, min_drop_pct: 10, require_approval: true, enabled: true }
  )
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<Rule>) => setR(x => ({ ...x, ...patch }))

  async function save() {
    setSaving(true)
    const res = initial
      ? await api(`/api/admin/social/autopost/${initial.id}`, { method: 'PATCH', json: toBody(r) })
      : await api('/api/admin/social/autopost', { method: 'POST', json: toBody(r) })
    setSaving(false)
    if (!res.ok) return showToast(res.data.error || 'Could not save', 'error')
    onDone(true)
  }

  if (!canWrite) return null
  return (
    <div className="mb-4 rounded-lg bg-surface-secondary p-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>When</label>
          <Select
            className="w-full"
            aria-label="When"
            value={r.trigger}
            onChange={v => set({ trigger: v as Rule['trigger'] })}
            options={Object.entries(TRIGGER_LABEL).map(([k, v]) => ({ value: k, label: v }))}
          />
        </div>
        <div>
          <label className={lbl}>Template</label>
          <Select
            className="w-full"
            aria-label="Template"
            value={String(r.template_id ?? '')}
            onChange={v => set({ template_id: v || null })}
            options={[{ value: '', label: 'Generated caption' }, ...templates.map(t => ({ value: String(t.id), label: t.name }))]}
          />
        </div>
        {r.trigger === 'price_drop' && (
          <div>
            <label className={lbl}>Minimum drop (%)</label>
            <input type="number" min={1} max={90} className={inputCls} value={r.min_drop_pct} onChange={e => set({ min_drop_pct: Number(e.target.value) })} />
          </div>
        )}
      </div>
      <div>
        <label className={lbl}>Networks</label>
        <div className="flex flex-wrap gap-3">
          {RULE_PLATFORMS.map(p => (
            <label key={p} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={r.platforms.includes(p)}
                onChange={e => set({ platforms: e.target.checked ? [...r.platforms, p] : r.platforms.filter(x => x !== p) })}
              />
              {PLATFORM_LABEL[p]}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle checked={r.require_approval} onChange={v => set({ require_approval: v })} label="Wait for approval" />
        <Toggle checked={r.enabled} onChange={v => set({ enabled: v })} label="Enabled" />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className={btnGhost} onClick={() => onDone(false)}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={saving || !r.platforms.length} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
