'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, PlugZap, Trash2 } from 'lucide-react'
import ConnectionsGear, { type ConnectionState } from '@/components/admin/ConnectionsGear'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { LoadingLines, Sk } from '@/components/admin/kit/skeleton'

type Provider = 'ewaybill' | 'einvoice'
interface ProviderStatus {
  provider: Provider
  connected: boolean
  username: string | null
  baseUrl: string | null
}
interface Status {
  flagship: boolean
  gstin: string | null
  defaults: Record<Provider, string>
  providers: ProviderStatus[]
}

const TITLE: Record<Provider, string> = { ewaybill: 'E-way bill API', einvoice: 'E-invoice (IRP) API' }
const EMPTY = { username: '', password: '', clientId: '', clientSecret: '', baseUrl: '' }

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  } catch {
    return { ok: false, data: { error: 'Network error' } }
  }
}

/** Header gear on the GST page: the store's own e-way bill / e-invoice API credentials. */
export default function TaxCredentialsGear() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const load = useCallback(async () => {
    const r = await call('/api/admin/gst/credentials', 'GET')
    if (r.ok) setStatus(r.data)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const n = status?.providers.filter(p => p.connected).length ?? 0
  const state: ConnectionState = n === 2 ? 'connected' : n === 1 ? 'pending' : 'none'
  return (
    <ConnectionsGear title="E-way bill and e-invoice API" scope="gst" state={state} open={open} onOpenChange={setOpen}>
      {!status ? (
        <div className="space-y-4">
          <LoadingLines lines={2} />
          {(['ewaybill', 'einvoice'] as const).map(p => (
            <div key={p} className="rounded-xl border border-border-default p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{TITLE[p]}</h3>
              <Sk className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground-secondary">
            {status.flagship
              ? "This store generates e-way bills and e-invoices with the platform's credentials (EWAYBILL_* and EINVOICE_*)."
              : `E-way bills and e-invoices are generated under your GSTIN${status.gstin ? ` ${status.gstin}` : ''} with your own API access from your GSP or the NIC portal. Without it they cannot be generated.`}
          </p>
          {!status.flagship && !status.gstin && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Add your GSTIN in Site Controls (business details) first.</p>
          )}
          {status.providers.map(p => (
            <ProviderCard key={p.provider} s={p} flagship={status.flagship} defaultBase={status.defaults[p.provider]} onChanged={load} />
          ))}
        </div>
      )}
    </ConnectionsGear>
  )
}

function ProviderCard({
  s,
  flagship,
  defaultBase,
  onChanged,
}: {
  s: ProviderStatus
  flagship: boolean
  defaultBase: string
  onChanged: () => Promise<void>
}) {
  const canWrite = useCanWrite('gst')
  const [f, setF] = useState(EMPTY)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const ready = !!(f.username.trim() && f.password && f.clientId.trim() && f.clientSecret.trim())

  async function run(kind: 'save' | 'test' | 'remove') {
    setBusy(kind)
    setNote(null)
    const r =
      kind === 'save'
        ? await call('/api/admin/gst/credentials', 'POST', { provider: s.provider, ...f, baseUrl: f.baseUrl.trim() || undefined })
        : kind === 'remove'
          ? await call('/api/admin/gst/credentials', 'DELETE', { provider: s.provider })
          : await call('/api/admin/gst/credentials/test', 'POST', { provider: s.provider })
    setBusy(null)
    if (kind === 'test') return setNote({ ok: !!r.data.ok, text: r.data.message || r.data.error || 'The test failed' })
    if (!r.ok) return setNote({ ok: false, text: r.data.error || 'Could not save' })
    setNote({ ok: true, text: kind === 'save' ? 'Saved. Use Test to check it.' : 'Removed.' })
    setF(EMPTY)
    setEditing(false)
    await onChanged()
  }

  const field = (k: keyof typeof EMPTY, label: string, secret = false, placeholder = '') => (
    <label className="block text-sm space-y-1 min-w-0">
      <span className="text-foreground-secondary">{label}</span>
      <input
        className={inputCls}
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        placeholder={placeholder}
        value={f[k]}
        onChange={e => setF(p => ({ ...p, [k]: e.target.value }))}
      />
    </label>
  )

  return (
    <div className="rounded-xl border border-border-default p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{TITLE[s.provider]}</h3>
        <span className={`text-xs ${s.connected ? 'text-green-700 dark:text-green-400' : 'text-foreground-muted'}`}>
          {s.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      {s.connected && (
        <p className="text-xs text-foreground-muted break-all">
          {s.username ? `User ${s.username}` : ''}
          {s.baseUrl ? ` · ${s.baseUrl}` : ''}
        </p>
      )}
      {!flagship && canWrite && (editing || !s.connected) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field('username', 'API username')}
          {field('password', 'API password', true)}
          {field('clientId', 'Client ID')}
          {field('clientSecret', 'Client secret', true)}
          <div className="sm:col-span-2">{field('baseUrl', 'API base URL (optional)', false, defaultBase)}</div>
          <p className="sm:col-span-2 text-xs text-foreground-muted">
            Register for API access on the NIC portal (or through your GSP) for your GSTIN, and paste the credentials it
            issues. Secrets are stored encrypted and never shown again.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!flagship && canWrite && (editing || !s.connected) && (
          <button type="button" className={btnPrimary} disabled={!!busy || !ready} onClick={() => run('save')}>
            {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        )}
        {!flagship && canWrite && s.connected && !editing && (
          <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
            Replace credentials
          </button>
        )}
        {(s.connected || flagship) && (
          <button type="button" className={btnGhost} disabled={!!busy} onClick={() => run('test')}>
            {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Test
          </button>
        )}
        {!flagship && canWrite && s.connected && (
          <button type="button" className={`${btnGhost} text-red-600`} disabled={!!busy} onClick={() => run('remove')}>
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        )}
      </div>
      {note && <p className={`text-xs break-words ${note.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{note.text}</p>}
    </div>
  )
}
