'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type IntegrationRow = { provider: string; label: string | null; status: string; meta: Record<string, any> }
type SocialRow = { provider: 'facebook' | 'instagram'; page_name: string | null; status: string }

const ECOM_BASE = process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in'

export default function IntegrationsClient({ tenant, integrations, socialAccounts }: {
  tenant: { id: string; slug: string; display_name: string }
  integrations: IntegrationRow[]
  socialAccounts: SocialRow[]
}) {
  const router = useRouter()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const connected = p.get('connected')
    if (!connected) return
    const err = p.get('error')
    if (err) setToast({ ok: false, text: `Could not connect ${connected}: ${err}` })
    else setToast({ ok: true, text: `${connected} connected successfully.` })
    const url = new URL(window.location.href)
    url.searchParams.delete('connected'); url.searchParams.delete('error')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const google = integrations.find((i) => i.provider === 'google_merchant')
  const amazon = integrations.find((i) => i.provider === 'amazon_seller')
  const fb = socialAccounts.find((s) => s.provider === 'facebook' && s.status === 'connected')
  const ig = socialAccounts.find((s) => s.provider === 'instagram' && s.status === 'connected')

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${toast.ok
          ? 'border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
          : 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GoogleCard tenantId={tenant.id} row={google} onDone={() => router.refresh()} setToast={setToast} />
        <AmazonCard tenantId={tenant.id} row={amazon} onDone={() => router.refresh()} setToast={setToast} />
        <MetaCard tenantId={tenant.id} fb={fb} ig={ig} />
      </div>
    </div>
  )
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${connected
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : 'bg-surface-secondary text-foreground-muted'}`}>
      {connected ? 'Connected' : 'Not connected'}
    </span>
  )
}

function CardShell({ title, subtitle, connected, children }: {
  title: string; subtitle: string; connected: boolean; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-6 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <StatusBadge connected={connected} />
      </div>
      <p className="text-sm text-foreground-muted mb-5">{subtitle}</p>
      <div className="mt-auto space-y-3">{children}</div>
    </div>
  )
}

function GoogleCard({ tenantId, row, onDone, setToast }: {
  tenantId: string; row?: IntegrationRow
  onDone: () => void; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sa, setSa] = useState(''); const [merchantId, setMerchantId] = useState('')
  const connected = !!row

  async function save() {
    setBusy(true); setToast(null)
    try {
      const res = await fetch('/api/ecom/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, provider: 'google_merchant', config: { service_account_json: sa, merchant_id: merchantId } }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Failed to save credentials' }); return }
      setToast({ ok: true, text: 'Google Merchant credentials saved.' }); setOpen(false); setSa(''); setMerchantId(''); onDone()
    } catch { setToast({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }

  return (
    <CardShell title="Google Merchant Center" subtitle="Sync your catalog to Google Shopping." connected={connected}>
      {connected && row?.meta?.merchant_id && (
        <div className="text-xs text-foreground-muted font-mono">Merchant ID: {row.meta.merchant_id}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!connected && (
          <a href={`/api/ecom/integrations/google/connect?tenantId=${tenantId}`}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
            Connect
          </a>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
          {open ? 'Hide' : 'Enter credentials'}
        </button>
        {connected && <SyncButton tenantId={tenantId} provider="google_merchant" setToast={setToast} />}
        {connected && <DisconnectButton tenantId={tenantId} provider="google_merchant" onDone={onDone} setToast={setToast} />}
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-border-default bg-surface-secondary/50 p-4">
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1">Service account JSON</label>
            <textarea value={sa} onChange={(e) => setSa(e.target.value)} rows={5}
              placeholder='{ "type": "service_account", ... }'
              className="w-full text-xs font-mono rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-foreground" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1">Merchant ID</label>
            <input value={merchantId} onChange={(e) => setMerchantId(e.target.value)}
              className="w-full text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-foreground" />
          </div>
          <button onClick={save} disabled={busy || !sa || !merchantId}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
            {busy ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      )}
    </CardShell>
  )
}

function AmazonCard({ tenantId, row, onDone, setToast }: {
  tenantId: string; row?: IntegrationRow
  onDone: () => void; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ client_id: '', client_secret: '', refresh_token: '', seller_id: '', marketplace_id: '' })
  const connected = !!row
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function save() {
    setBusy(true); setToast(null)
    try {
      const config: Record<string, string> = { ...f }
      if (!config.marketplace_id) delete config.marketplace_id
      const res = await fetch('/api/ecom/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, provider: 'amazon_seller', config }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Failed to save credentials' }); return }
      setToast({ ok: true, text: 'Amazon Seller credentials saved.' }); setOpen(false)
      setF({ client_id: '', client_secret: '', refresh_token: '', seller_id: '', marketplace_id: '' }); onDone()
    } catch { setToast({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }

  const fields: Array<{ k: keyof typeof f; label: string; required: boolean }> = [
    { k: 'client_id', label: 'Client ID', required: true },
    { k: 'client_secret', label: 'Client secret', required: true },
    { k: 'refresh_token', label: 'Refresh token', required: true },
    { k: 'seller_id', label: 'Seller ID', required: true },
    { k: 'marketplace_id', label: 'Marketplace ID (optional)', required: false },
  ]

  return (
    <CardShell title="Amazon Seller" subtitle="List your products on Amazon.in." connected={connected}>
      {connected && row?.meta?.seller_id && (
        <div className="text-xs text-foreground-muted font-mono">Seller ID: {row.meta.seller_id}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!connected && (
          <a href={`/api/ecom/integrations/amazon/connect?tenantId=${tenantId}`}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
            Connect
          </a>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
          {open ? 'Hide' : 'Enter credentials'}
        </button>
        {connected && <SyncButton tenantId={tenantId} provider="amazon_seller" setToast={setToast} />}
        {connected && <DisconnectButton tenantId={tenantId} provider="amazon_seller" onDone={onDone} setToast={setToast} />}
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-border-default bg-surface-secondary/50 p-4">
          {fields.map((fl) => (
            <div key={fl.k}>
              <label className="block text-xs font-medium text-foreground-muted mb-1">{fl.label}</label>
              <input value={f[fl.k]} onChange={set(fl.k)}
                className="w-full text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-foreground" />
            </div>
          ))}
          <button onClick={save} disabled={busy || !f.client_id || !f.client_secret || !f.refresh_token || !f.seller_id}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
            {busy ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      )}
    </CardShell>
  )
}

function MetaCard({ tenantId, fb, ig }: { tenantId: string; fb?: SocialRow; ig?: SocialRow }) {
  const connected = !!fb || !!ig
  return (
    <CardShell title="Meta (Facebook & Instagram)" subtitle="Auto-post new products to your pages." connected={connected}>
      {fb && <div className="text-xs text-foreground-muted">Facebook: <span className="text-foreground font-medium">{fb.page_name || 'Connected'}</span></div>}
      {ig && <div className="text-xs text-foreground-muted">Instagram: <span className="text-foreground font-medium">{ig.page_name || 'Connected'}</span></div>}
      <a href={`/api/ecom/social/connect/facebook?tenantId=${tenantId}`}
        className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${connected
          ? 'border border-border-default text-foreground-secondary hover:bg-surface-secondary'
          : 'bg-accent-600 hover:bg-accent-700 text-white'}`}>
        {connected ? 'Reconnect' : 'Connect'}
      </a>
    </CardShell>
  )
}

function SyncButton({ tenantId, provider, setToast }: {
  tenantId: string; provider: string; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [busy, setBusy] = useState(false)
  async function sync() {
    setBusy(true); setToast(null)
    try {
      const res = await fetch('/api/ecom/integrations/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, provider }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Sync failed' }); return }
      setToast({ ok: true, text: 'Sync started.' })
    } catch { setToast({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={sync} disabled={busy}
      className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 text-sm font-medium transition-colors">
      {busy ? 'Syncing…' : 'Sync now'}
    </button>
  )
}

function DisconnectButton({ tenantId, provider, onDone, setToast }: {
  tenantId: string; provider: string; onDone: () => void; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [busy, setBusy] = useState(false)
  async function disconnect() {
    setBusy(true); setToast(null)
    try {
      const res = await fetch('/api/ecom/integrations', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, provider }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Failed to disconnect' }); return }
      setToast({ ok: true, text: 'Disconnected.' }); onDone()
    } catch { setToast({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={disconnect} disabled={busy}
      className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 text-sm font-medium transition-colors">
      {busy ? 'Removing…' : 'Disconnect'}
    </button>
  )
}
