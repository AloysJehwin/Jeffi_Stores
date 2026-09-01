'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type IntegrationRow = { provider: string; label: string | null; status: string; meta: Record<string, any> }
type SocialRow = { provider: 'facebook' | 'instagram'; page_name: string | null; status: string }

// Store-admin credentials popup. Opened by a gear button next to a provider's actions on
// /admin/merchant-sync (google + amazon) and /admin/social-posts (meta). All fetches target the
// admin-scoped /api/admin/integrations* routes; the tenant is implicit (resolved from the admin
// host server-side), so no tenantId is ever sent from the client.

export default function AdminIntegrationsPopup({
  scope,
  integrations,
  socialAccounts,
}: {
  scope: 'merchant' | 'social'
  integrations: IntegrationRow[]
  socialAccounts: SocialRow[]
}) {
  const router = useRouter()
  const canWrite = useCanWrite(scope === 'merchant' ? 'merchant_sync' : 'campaigns')
  const [open, setOpen] = useState(false)
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
    <>
      <button type="button" onClick={() => setOpen(true)} title="Configure credentials"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
        <Settings className="w-4 h-4" /> Configure
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-border-default bg-surface-elevated shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
              <h2 className="text-base font-bold text-foreground">
                {scope === 'merchant' ? 'Marketplace credentials' : 'Social credentials'}
              </h2>
              <button type="button" onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-foreground-muted hover:bg-surface-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {toast && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${toast.ok
                  ? 'border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                  {toast.text}
                </div>
              )}
              {scope === 'merchant' ? (
                <>
                  <GoogleCard row={google} canWrite={canWrite} onDone={() => router.refresh()} setToast={setToast} />
                  <AmazonCard row={amazon} canWrite={canWrite} onDone={() => router.refresh()} setToast={setToast} />
                </>
              ) : (
                <MetaCard fb={fb} ig={ig} canWrite={canWrite} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
    <div className="rounded-2xl border border-border-default bg-surface-secondary/40 p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <StatusBadge connected={connected} />
      </div>
      <p className="text-xs text-foreground-muted mb-4">{subtitle}</p>
      <div className="mt-auto space-y-3">{children}</div>
    </div>
  )
}

function GoogleCard({ row, canWrite, onDone, setToast }: {
  row?: IntegrationRow; canWrite: boolean
  onDone: () => void; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sa, setSa] = useState(''); const [merchantId, setMerchantId] = useState('')
  const connected = !!row

  async function save() {
    setBusy(true); setToast(null)
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google_merchant', config: { service_account_json: sa, merchant_id: merchantId } }),
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
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        {!connected && (
          <a href="/api/admin/integrations/google/connect"
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
            Connect
          </a>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
          {open ? 'Hide' : 'Enter credentials'}
        </button>
        {connected && <DisconnectButton provider="google_merchant" onDone={onDone} setToast={setToast} />}
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4">
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1">Service account JSON</label>
            <textarea value={sa} onChange={(e) => setSa(e.target.value)} rows={5}
              placeholder='{ "type": "service_account", ... }'
              className="w-full text-xs font-mono rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-foreground" />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1">Merchant ID</label>
            <input value={merchantId} onChange={(e) => setMerchantId(e.target.value)}
              className="w-full text-sm rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-foreground" />
          </div>
          <button onClick={save} disabled={busy || !sa || !merchantId}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
            {busy ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      )}
      </>
      )}
    </CardShell>
  )
}

function AmazonCard({ row, canWrite, onDone, setToast }: {
  row?: IntegrationRow; canWrite: boolean
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
      const res = await fetch('/api/admin/integrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'amazon_seller', config }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Failed to save credentials' }); return }
      setToast({ ok: true, text: 'Amazon Seller credentials saved.' }); setOpen(false)
      setF({ client_id: '', client_secret: '', refresh_token: '', seller_id: '', marketplace_id: '' }); onDone()
    } catch { setToast({ ok: false, text: 'Network error' }) } finally { setBusy(false) }
  }

  const fields: Array<{ k: keyof typeof f; label: string }> = [
    { k: 'client_id', label: 'Client ID' },
    { k: 'client_secret', label: 'Client secret' },
    { k: 'refresh_token', label: 'Refresh token' },
    { k: 'seller_id', label: 'Seller ID' },
    { k: 'marketplace_id', label: 'Marketplace ID (optional)' },
  ]

  return (
    <CardShell title="Amazon Seller" subtitle="List your products on Amazon.in." connected={connected}>
      {connected && row?.meta?.seller_id && (
        <div className="text-xs text-foreground-muted font-mono">Seller ID: {row.meta.seller_id}</div>
      )}
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        {!connected && (
          <a href="/api/admin/integrations/amazon/connect"
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-semibold transition-colors">
            Connect
          </a>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="px-4 py-2 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors">
          {open ? 'Hide' : 'Enter credentials'}
        </button>
        {connected && <DisconnectButton provider="amazon_seller" onDone={onDone} setToast={setToast} />}
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4">
          {fields.map((fl) => (
            <div key={fl.k}>
              <label className="block text-xs font-medium text-foreground-muted mb-1">{fl.label}</label>
              <input value={f[fl.k]} onChange={set(fl.k)}
                className="w-full text-sm rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-foreground" />
            </div>
          ))}
          <button onClick={save} disabled={busy || !f.client_id || !f.client_secret || !f.refresh_token || !f.seller_id}
            className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
            {busy ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      )}
      </>
      )}
    </CardShell>
  )
}

function MetaCard({ fb, ig, canWrite }: { fb?: SocialRow; ig?: SocialRow; canWrite: boolean }) {
  const connected = !!fb || !!ig
  return (
    <CardShell title="Meta (Facebook & Instagram)" subtitle="Auto-post new products to your pages." connected={connected}>
      {fb && <div className="text-xs text-foreground-muted">Facebook: <span className="text-foreground font-medium">{fb.page_name || 'Connected'}</span></div>}
      {ig && <div className="text-xs text-foreground-muted">Instagram: <span className="text-foreground font-medium">{ig.page_name || 'Connected'}</span></div>}
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
      <button type="button" onClick={() => { window.location.href = '/api/admin/social/connect/facebook' }}
        className={`inline-block px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${connected
          ? 'border border-border-default text-foreground-secondary hover:bg-surface-secondary'
          : 'bg-accent-600 hover:bg-accent-700 text-white'}`}>
        {connected ? 'Reconnect' : 'Connect'}
      </button>
      )}
    </CardShell>
  )
}

function DisconnectButton({ provider, onDone, setToast }: {
  provider: string; onDone: () => void; setToast: (t: { ok: boolean; text: string } | null) => void
}) {
  const [busy, setBusy] = useState(false)
  async function disconnect() {
    setBusy(true); setToast(null)
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
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
