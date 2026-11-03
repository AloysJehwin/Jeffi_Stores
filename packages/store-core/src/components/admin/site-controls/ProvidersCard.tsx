'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Select from '@/components/ui/Select'
import { Badge, Banner, TabAction, Table, Tabs, api, btnGhost, btnPrimary, when } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import { SectionCard } from './controls'

// Flagship Site Controls only (platform owner): the provider policy every store follows, plus per-store overrides.

type Key = 'sms_provider' | 'whatsapp_provider' | 'ai_text_providers' | 'ai_image_providers' | 'ai_video_providers' | 'ai_image_default_quality'
type Setting = { tenant_id: string | null; key: Key; value: unknown; updated_by: string | null; updated_at: string }
type Tenant = { id: string; slug: string; display_name: string }
type Status = { name: string; configured: boolean }
type Gateway = { text: Status[]; image: Status[]; video: Status[]; defaults: { text: string[]; image: string[]; video: string[] } }
type Data = {
  settings: Setting[]
  tenants: Tenant[]
  messaging: Record<'sms' | 'whatsapp', Record<'twilio' | 'aws', boolean>>
  gateway: Gateway | null
}
type Tab = 'default' | 'overrides'
type Cap = 'text' | 'image' | 'video'

const KEY_LABEL: Record<Key, string> = {
  sms_provider: 'SMS provider',
  whatsapp_provider: 'WhatsApp provider',
  ai_text_providers: 'AI text order',
  ai_image_providers: 'AI image order',
  ai_video_providers: 'AI video order',
  ai_image_default_quality: 'Image default quality',
}
const ALL: Record<Cap, string[]> = { text: ['anthropic', 'razer'], image: ['razer', 'google', 'replicate'], video: ['google', 'replicate'] }
const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Claude', razer: 'Razer', google: 'Google', replicate: 'Replicate', twilio: 'Twilio', aws: 'AWS' }
const QUALITY = ['draft', 'standard', 'premium']
const capOf = (k: Key): Cap | null => (k === 'ai_text_providers' ? 'text' : k === 'ai_image_providers' ? 'image' : k === 'ai_video_providers' ? 'video' : null)
const label = (p: string) => PROVIDER_LABEL[p] ?? p
const describeValue = (k: Key, v: unknown) =>
  Array.isArray(v) ? (v.length ? v.map(x => label(String(x))).join(' > ') : 'Gateway default') : k === 'ai_image_default_quality' ? String(v) : label(String(v))

export default function ProvidersCard() {
  const canWrite = useCanWrite('settings:write')
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('default')
  const toast = useActionToast()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    const { ok, data } = await api<Data>('/api/admin/settings/providers')
    if (ok) setData(data)
    else setLoadError(data.error || 'Could not load provider settings')
  }
  useEffect(() => {
    load()
  }, [])

  async function save(tenantId: string | null, key: Key, value: unknown) {
    const { ok, data: d } = await api('/api/admin/settings/providers', { method: 'PUT', json: { tenantId, key, value } })
    toast.result({ ok, text: ok ? `${KEY_LABEL[key]} saved` : d.error || 'Save failed' })
    if (ok) await load()
    return ok
  }

  async function clear(tenantId: string | null, key: Key) {
    const qs = new URLSearchParams({ key, ...(tenantId ? { tenantId } : {}) })
    const { ok, data: d } = await api(`/api/admin/settings/providers?${qs}`, { method: 'DELETE' })
    toast.result({ ok, text: ok ? `${KEY_LABEL[key]} reset` : d.error || 'Reset failed' })
    if (ok) await load()
  }

  const platform = useMemo(() => new Map((data?.settings ?? []).filter(s => !s.tenant_id).map(s => [s.key, s.value])), [data])
  const overrides = useMemo(() => (data?.settings ?? []).filter(s => s.tenant_id), [data])
  const tenantName = useMemo(() => new Map((data?.tenants ?? []).map(t => [t.id, t.display_name || t.slug])), [data])

  return (
    <SectionCard
      title="Providers"
      description="Which provider sends SMS and WhatsApp and serves AI text, images and video for every store. A store override beats the platform default. Changes apply within 30 seconds."
    >
      <Tabs
        tabs={[
          { id: 'default' as Tab, label: 'Platform default' },
          { id: 'overrides' as Tab, label: 'Store overrides', count: overrides.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
        actions={
          canWrite && tab === 'overrides' ? <TabAction icon={<Plus className="w-4 h-4" />} label="Add override" onClick={() => setAdding(a => !a)} /> : undefined
        }
      />
      {loadError && !data && <Banner ok={false}>{loadError}</Banner>}
      {!data ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : tab === 'default' ? (
        <>
          <Section title="Messaging">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(['sms_provider', 'whatsapp_provider'] as const).map(k => (
                <MessagingField
                  key={k}
                  k={k}
                  value={(platform.get(k) as string) ?? null}
                  ready={data.messaging[k === 'sms_provider' ? 'sms' : 'whatsapp']}
                  disabled={!canWrite}
                  onSave={v => save(null, k, v)}
                  onReset={() => clear(null, k)}
                  unsetHint="Not set: each store keeps its earlier Site Controls choice (Twilio by default)."
                />
              ))}
            </div>
          </Section>
          <Section title="AI">
            {!data.gateway && <p className="text-xs text-foreground-muted mb-3">The AI gateway did not answer; configured state is unknown.</p>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {(['ai_text_providers', 'ai_image_providers', 'ai_video_providers'] as const).map(k => (
                <OrderEditor
                  key={k}
                  title={KEY_LABEL[k]}
                  cap={capOf(k)!}
                  value={(platform.get(k) as string[]) ?? []}
                  gateway={data.gateway}
                  disabled={!canWrite}
                  onSave={v => save(null, k, v)}
                  onReset={() => clear(null, k)}
                />
              ))}
            </div>
            <div className="mt-4 max-w-xs">
              <QualityField value={(platform.get('ai_image_default_quality') as string) ?? ''} disabled={!canWrite} onSave={v => (v ? save(null, 'ai_image_default_quality', v) : clear(null, 'ai_image_default_quality'))} />
            </div>
          </Section>
        </>
      ) : (
        <>
          {adding && canWrite && <AddOverride data={data} onCancel={() => setAdding(false)} onSave={async (t, k, v) => (await save(t, k, v)) && setAdding(false)} />}
          <Section title="Store overrides">
            <Table
              rows={overrides}
              rowKey={r => `${r.tenant_id}:${r.key}`}
              empty="No store overrides. Every store follows the platform default."
              cols={[
                { key: 'store', label: 'Store', render: r => tenantName.get(r.tenant_id!) ?? r.tenant_id, sort: r => tenantName.get(r.tenant_id!) ?? '' },
                { key: 'key', label: 'Setting', render: r => KEY_LABEL[r.key] ?? r.key, sort: r => r.key },
                { key: 'value', label: 'Value', render: r => <Badge tone="blue">{describeValue(r.key, r.value)}</Badge> },
                { key: 'by', label: 'Updated by', render: r => <span className="text-xs text-foreground-muted">{r.updated_by || '-'}</span> },
                { key: 'at', label: 'Updated', render: r => <span className="text-xs text-foreground-muted">{when(r.updated_at)}</span>, sort: r => r.updated_at },
                {
                  key: 'clear',
                  label: '',
                  render: r =>
                    canWrite ? (
                      <button type="button" className={btnGhost} onClick={() => clear(r.tenant_id, r.key)} aria-label="Clear override" title="Clear override">
                        <X className="w-4 h-4" />
                      </button>
                    ) : null,
                },
              ]}
            />
          </Section>
        </>
      )}
    </SectionCard>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</h3>
      {children}
    </div>
  )
}

function MessagingField({
  k,
  value,
  ready,
  disabled,
  onSave,
  onReset,
  unsetHint,
}: {
  k: 'sms_provider' | 'whatsapp_provider'
  value: string | null
  ready: Record<'twilio' | 'aws', boolean>
  disabled: boolean
  onSave: (v: string) => void
  onReset?: () => void
  unsetHint?: string
}) {
  return (
    <div>
      <span className="block text-xs text-foreground-muted mb-1">{KEY_LABEL[k]}</span>
      <div className="flex gap-2 items-center">
        <Select
          className="flex-1 min-w-0"
          aria-label={KEY_LABEL[k]}
          value={value ?? ''}
          disabled={disabled}
          placeholder="Not set"
          onChange={v => v && onSave(v)}
          options={[
            { value: 'twilio', label: 'Twilio', disabled: !ready.twilio, hint: ready.twilio ? undefined : 'Credentials missing' },
            { value: 'aws', label: 'AWS', disabled: !ready.aws, hint: ready.aws ? undefined : 'Unavailable until onboarding completes' },
          ]}
        />
        {value && onReset && !disabled && (
          <button type="button" className={btnGhost} onClick={onReset} aria-label="Reset" title="Reset">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {!value && unsetHint && <p className="text-xs text-foreground-muted mt-1">{unsetHint}</p>}
    </div>
  )
}

function QualityField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  return (
    <div>
      <span className="block text-xs text-foreground-muted mb-1">{KEY_LABEL.ai_image_default_quality}</span>
      <Select
        aria-label={KEY_LABEL.ai_image_default_quality}
        value={value}
        disabled={disabled}
        onChange={onSave}
        options={[{ value: '', label: 'Caller decides' }, ...QUALITY.map(q => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))]}
      />
    </div>
  )
}

function OrderEditor({
  title,
  cap,
  value,
  gateway,
  disabled,
  onSave,
  onReset,
}: {
  title: string
  cap: Cap
  value: string[]
  gateway: Gateway | null
  disabled: boolean
  onSave: (v: string[]) => void
  onReset?: () => void
}) {
  const base = value.length ? value : (gateway?.defaults[cap] ?? ALL[cap])
  const [draft, setDraft] = useState<string[]>(base)
  useEffect(() => setDraft(value.length ? value : (gateway?.defaults[cap] ?? ALL[cap])), [value, gateway, cap])
  const configured = new Map((gateway?.[cap] ?? []).map(s => [s.name, s.configured]))
  const rows = [...draft, ...ALL[cap].filter(p => !draft.includes(p))]
  const custom = value.length > 0
  const dirty = draft.join(',') !== value.join(',')

  const move = (i: number, d: -1 | 1) =>
    setDraft(cur => {
      const n = [...cur]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })
  const toggle = (p: string) => setDraft(cur => (cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]))

  return (
    <div className="rounded-lg border border-border-default p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <Badge tone={custom ? 'blue' : 'muted'}>{custom ? 'Custom' : 'Gateway default'}</Badge>
      </div>
      <ul className="space-y-1">
        {rows.map(p => {
          const i = draft.indexOf(p)
          const on = i >= 0
          const c = configured.get(p)
          return (
            <li key={p} className={`flex items-center gap-2 text-sm ${on ? '' : 'opacity-60'}`}>
              <input type="checkbox" aria-label={`Use ${label(p)}`} checked={on} disabled={disabled} onChange={() => toggle(p)} />
              <span className="flex-1 text-foreground">
                {on ? `${i + 1}. ` : ''}
                {label(p)}
              </span>
              {c !== undefined && <Badge tone={c ? 'green' : 'amber'}>{c ? 'Configured' : 'Not configured'}</Badge>}
              <button type="button" className="p-1 disabled:opacity-30" disabled={disabled || !on || i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-1 disabled:opacity-30"
                disabled={disabled || !on || i === draft.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
                title="Move down"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
      {!disabled && (
        <div className="flex gap-2 mt-3">
          <button type="button" className={btnPrimary} disabled={!draft.length || (!dirty && custom)} onClick={() => onSave(draft)}>
            Save order
          </button>
          {custom && onReset && (
            <button type="button" className={btnGhost} onClick={onReset}>
              Use gateway default
            </button>
          )}
        </div>
      )}
      {!draft.length && <p className="text-xs text-foreground-muted mt-1">Enable at least one provider.</p>}
    </div>
  )
}

function AddOverride({ data, onCancel, onSave }: { data: Data; onCancel: () => void; onSave: (tenantId: string, k: Key, v: unknown) => void }) {
  const [tenantId, setTenantId] = useState('')
  const [key, setKey] = useState<Key>('sms_provider')
  const cap = capOf(key)
  return (
    <Section title="New store override">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 mb-4">
        <div>
          <span className="block text-xs text-foreground-muted mb-1">Store</span>
          <Select
            aria-label="Store"
            value={tenantId}
            placeholder="Pick a store"
            onChange={setTenantId}
            options={data.tenants.map(t => ({ value: t.id, label: t.display_name || t.slug, hint: t.slug }))}
          />
        </div>
        <div>
          <span className="block text-xs text-foreground-muted mb-1">Setting</span>
          <Select aria-label="Setting" value={key} onChange={v => setKey(v as Key)} options={(Object.keys(KEY_LABEL) as Key[]).map(k => ({ value: k, label: KEY_LABEL[k] }))} />
        </div>
      </div>
      {!tenantId ? (
        <p className="text-sm text-foreground-muted">Pick a store to set its override.</p>
      ) : key === 'sms_provider' || key === 'whatsapp_provider' ? (
        <div className="max-w-sm">
          <MessagingField k={key} value={null} ready={data.messaging[key === 'sms_provider' ? 'sms' : 'whatsapp']} disabled={false} onSave={v => onSave(tenantId, key, v)} />
        </div>
      ) : key === 'ai_image_default_quality' ? (
        <div className="max-w-xs">
          <QualityField value="" disabled={false} onSave={v => v && onSave(tenantId, key, v)} />
        </div>
      ) : (
        <div className="max-w-md">
          <OrderEditor title={KEY_LABEL[key]} cap={cap!} value={[]} gateway={data.gateway} disabled={false} onSave={v => onSave(tenantId, key, v)} />
        </div>
      )}
      <div className="mt-3">
        <button type="button" className={btnGhost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Section>
  )
}
