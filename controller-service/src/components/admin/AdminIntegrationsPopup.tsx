'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type IntegrationRow = { provider: string; label: string | null; status: string; meta: Record<string, any> }
type SocialRow = {
  provider: 'facebook' | 'instagram'
  page_name: string | null
  page_id?: string | null
  status: string
}
type OAuthInfo = { enabled: boolean; redirectUri: string }
type OAuthMap = Partial<Record<'google_merchant' | 'amazon_seller' | 'meta', OAuthInfo>>
type Toast = { ok: boolean; text: string } | null
type SetToast = (t: Toast) => void

// Store-admin credentials popup. Opened by a gear button on /admin/merchant and /admin/amazon (google + amazon)
// and /admin/social-posts (meta). Each provider can connect by OAuth (when the platform app is
// configured) or by entering credentials directly. All fetches target the admin-scoped routes; the
// tenant is resolved from the admin host server-side, never sent from the client.

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google Merchant Center',
  amazon: 'Amazon Seller',
  meta: 'Facebook / Instagram',
}

const ERROR_TEXT: Record<string, string> = {
  not_configured: 'sign-in is not set up on this platform yet. Enter the credentials manually instead.',
  bad_state: 'the sign-in link expired or was not valid. Please try again.',
  missing_params: 'the provider did not return an authorization code. Please try again.',
  invalid_merchant_id: 'enter your numeric Merchant Center ID first.',
  scope_not_granted: 'Merchant Center access was not granted. Tick the permission on the consent screen.',
  no_refresh_token:
    'Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions and connect again.',
  access_denied: 'access was declined.',
}

function resultToast(): Toast {
  const p = new URLSearchParams(window.location.search)
  const connected = p.get('connected')
  if (!connected) return null
  const err = p.get('error')
  const name = PROVIDER_NAMES[p.get('provider') || connected] || connected
  if (connected === '0' || err) return { ok: false, text: `Could not connect ${name}: ${ERROR_TEXT[err || ''] || err}` }
  const reg = p.get('register_error')
  if (reg) return { ok: false, text: `${name} connected, but Merchant API sync could not be enabled: ${reg}` }
  return { ok: true, text: `${name} connected. Use Test connection to check it.` }
}

export default function AdminIntegrationsPopup({
  scope,
  integrations,
  socialAccounts,
  oauth = {},
}: {
  scope: 'merchant' | 'social'
  integrations: IntegrationRow[]
  socialAccounts: SocialRow[]
  oauth?: OAuthMap
}) {
  const router = useRouter()
  const canWrite = useCanWrite(scope === 'merchant' ? 'merchant_sync' : 'campaigns')
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<Toast>(null)

  useEffect(() => {
    const t = resultToast()
    if (!t) return
    setToast(t)
    setOpen(true)
    const url = new URL(window.location.href)
    for (const k of ['connected', 'error', 'provider', 'register_error']) url.searchParams.delete(k)
    window.history.replaceState({}, '', url.toString())
  }, [])

  const google = integrations.find(i => i.provider === 'google_merchant')
  const amazon = integrations.find(i => i.provider === 'amazon_seller')
  const fb = socialAccounts.find(s => s.provider === 'facebook' && s.status === 'connected')
  const ig = socialAccounts.find(s => s.provider === 'instagram' && s.status === 'connected')
  const done = () => router.refresh()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Configure credentials"
        className="inline-flex items-center gap-1.5 px-3 h-control-sm rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary text-sm font-medium transition-colors"
      >
        <Settings className="w-4 h-4" /> Configure
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border-default bg-surface-elevated shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
              <h2 className="text-base font-bold text-foreground">
                {scope === 'merchant' ? 'Marketplace credentials' : 'Social credentials'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-foreground-muted hover:bg-surface-secondary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {toast && <Notice ok={toast.ok} text={toast.text} />}
              {scope === 'merchant' ? (
                <>
                  <GoogleCard
                    row={google}
                    oauth={oauth.google_merchant}
                    canWrite={canWrite}
                    onDone={done}
                    setToast={setToast}
                  />
                  <AmazonCard
                    row={amazon}
                    oauth={oauth.amazon_seller}
                    canWrite={canWrite}
                    onDone={done}
                    setToast={setToast}
                  />
                </>
              ) : (
                <MetaCard fb={fb} ig={ig} oauth={oauth.meta} canWrite={canWrite} onDone={done} setToast={setToast} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm break-words ${
        ok
          ? 'border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
          : 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
      }`}
    >
      {text}
    </div>
  )
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        connected
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-surface-secondary text-foreground-muted'
      }`}
    >
      {connected ? 'Connected' : 'Not connected'}
    </span>
  )
}

function CardShell({
  title,
  subtitle,
  connected,
  children,
}: {
  title: string
  subtitle: string
  connected: boolean
  children: React.ReactNode
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

function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="text-xs text-foreground-muted">
      {label}: <span className="text-foreground font-medium font-mono">{value}</span>
    </div>
  )
}

// Shown when the platform has not set up the provider's OAuth app: tells the tenant to use manual
// entry, and the platform owner which redirect URI to register.
function OAuthUnavailable({ provider, oauth }: { provider: string; oauth?: OAuthInfo }) {
  return (
    <p className="text-xs text-foreground-muted">
      Sign-in with {provider} is not available on this platform yet, so enter the credentials manually.
      {oauth?.redirectUri && (
        <>
          {' '}
          Platform owner: register <span className="font-mono break-all">{oauth.redirectUri}</span> as the redirect URI
          in the {provider} developer console and set the app credentials.
        </>
      )}
    </p>
  )
}

const btnSecondary =
  'px-4 h-control rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 text-sm font-medium transition-colors'
const btnPrimary =
  'inline-flex items-center px-4 h-control rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors'
const inputCls =
  'w-full text-sm rounded-lg border border-border-default bg-surface-secondary px-3 h-control text-foreground'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground-muted mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-foreground-muted">{hint}</p>}
    </div>
  )
}

async function postJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: { error: 'Network error' } }
  }
}

function TestButton({ provider, setToast }: { provider: string; setToast: SetToast }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    setToast(null)
    const { ok, data } = await postJson('/api/admin/integrations/test', 'POST', { provider })
    setToast({ ok: ok && !!data.ok, text: data.message || data.error || 'Test failed' })
    setBusy(false)
  }
  return (
    <button type="button" onClick={run} disabled={busy} className={btnSecondary}>
      {busy ? 'Testing…' : 'Test connection'}
    </button>
  )
}

// One-time Merchant API registration of the connected account (also done on every Google sign-in).
function EnableMerchantApiButton({ setToast }: { setToast: SetToast }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    setToast(null)
    const { ok, data } = await postJson('/api/admin/merchant/register', 'POST')
    setToast({ ok: ok && !!data.ok, text: data.message || data.error || 'Could not enable Merchant API sync' })
    setBusy(false)
  }
  return (
    <button type="button" onClick={run} disabled={busy} className={btnSecondary}>
      {busy ? 'Enabling…' : 'Enable Merchant API sync'}
    </button>
  )
}

function DisconnectButton({
  url,
  body,
  onDone,
  setToast,
}: {
  url: string
  body?: unknown
  onDone: () => void
  setToast: SetToast
}) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  async function disconnect() {
    setBusy(true)
    setToast(null)
    const { ok, data } = await postJson(url, 'DELETE', body)
    setToast(ok ? { ok: true, text: 'Disconnected.' } : { ok: false, text: data.error || 'Failed to disconnect' })
    setBusy(false)
    setConfirm(false)
    if (ok) onDone()
  }
  return (
    <button
      type="button"
      onClick={() => (confirm ? disconnect() : setConfirm(true))}
      onBlur={() => setConfirm(false)}
      disabled={busy}
      className="px-4 h-control rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 text-sm font-medium transition-colors"
    >
      {busy ? 'Removing…' : confirm ? 'Click again to disconnect' : 'Disconnect'}
    </button>
  )
}

function viaLabel(via: string | undefined, oauthName: string): string {
  return via === 'oauth' ? oauthName : 'Credentials entered manually'
}

function GoogleCard({
  row,
  oauth,
  canWrite,
  onDone,
  setToast,
}: {
  row?: IntegrationRow
  oauth?: OAuthInfo
  canWrite: boolean
  onDone: () => void
  setToast: SetToast
}) {
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sa, setSa] = useState('')
  const [merchantId, setMerchantId] = useState(row?.meta?.merchant_id ? String(row.meta.merchant_id) : '')
  const [dataSource, setDataSource] = useState('')
  const connected = !!row
  const validId = /^\d{5,20}$/.test(merchantId.trim())

  async function save() {
    setBusy(true)
    setToast(null)
    const { ok, data } = await postJson('/api/admin/integrations', 'POST', {
      provider: 'google_merchant',
      config: { service_account_json: sa, merchant_id: merchantId.trim(), data_source: dataSource.trim() },
    })
    setBusy(false)
    if (!ok) return setToast({ ok: false, text: data.error || 'Failed to save credentials' })
    setToast({ ok: true, text: 'Google Merchant credentials saved. Use Test connection to check them.' })
    setManual(false)
    setSa('')
    onDone()
  }

  return (
    <CardShell title="Google Merchant Center" subtitle="Sync your catalog to Google Shopping." connected={connected}>
      {connected && (
        <div className="space-y-0.5">
          <Detail label="Merchant ID" value={row?.meta?.merchant_id} />
          <Detail label="Method" value={row?.meta?.connected_via === 'oauth' ? 'Google sign-in' : 'Service account'} />
          <Detail label="Service account" value={row?.meta?.client_email} />
        </div>
      )}
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
        <>
          <Field label="Merchant Center ID" hint="The number shown at the top of Merchant Center.">
            <input
              value={merchantId}
              onChange={e => setMerchantId(e.target.value)}
              inputMode="numeric"
              placeholder="123456789"
              className={inputCls}
            />
          </Field>
          {oauth?.enabled ? null : <OAuthUnavailable provider="Google" oauth={oauth} />}
          <div className="flex flex-wrap items-center gap-2">
            {oauth?.enabled && (
              <a
                href={validId ? `/api/admin/integrations/google/connect?merchant_id=${merchantId.trim()}` : undefined}
                aria-disabled={!validId}
                className={`${btnPrimary} ${validId ? '' : 'pointer-events-none opacity-40'}`}
              >
                {connected ? 'Reconnect with Google' : 'Connect with Google'}
              </a>
            )}
            <button type="button" onClick={() => setManual(o => !o)} className={btnSecondary}>
              {manual ? 'Hide manual entry' : 'Enter service account'}
            </button>
            {connected && <TestButton provider="google_merchant" setToast={setToast} />}
            {connected && row?.meta?.connected_via === 'oauth' && <EnableMerchantApiButton setToast={setToast} />}
            {connected && (
              <DisconnectButton
                url="/api/admin/integrations"
                body={{ provider: 'google_merchant' }}
                onDone={onDone}
                setToast={setToast}
              />
            )}
          </div>
          {manual && (
            <div className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4">
              <Field
                label="Service account key (JSON)"
                hint="Create a key in Google Cloud > IAM > Service accounts, then add the service account's email as a user in Merchant Center (People and access)."
              >
                <textarea
                  value={sa}
                  onChange={e => setSa(e.target.value)}
                  rows={5}
                  placeholder='{ "type": "service_account", ... }'
                  className="w-full text-xs font-mono rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-foreground"
                />
              </Field>
              <Field
                label="Data source (optional)"
                hint="Merchant API data source id; one is found or created when blank."
              >
                <input value={dataSource} onChange={e => setDataSource(e.target.value)} className={inputCls} />
              </Field>
              <button onClick={save} disabled={busy || !sa.trim() || !validId} className={btnPrimary}>
                {busy ? 'Saving…' : 'Save credentials'}
              </button>
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}

const AMAZON_EMPTY = { client_id: '', client_secret: '', refresh_token: '', seller_id: '', marketplace_id: '' }

function AmazonCard({
  row,
  oauth,
  canWrite,
  onDone,
  setToast,
}: {
  row?: IntegrationRow
  oauth?: OAuthInfo
  canWrite: boolean
  onDone: () => void
  setToast: SetToast
}) {
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState(AMAZON_EMPTY)
  const connected = !!row
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    setBusy(true)
    setToast(null)
    const config: Record<string, string> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]))
    if (!config.marketplace_id) delete config.marketplace_id
    const { ok, data } = await postJson('/api/admin/integrations', 'POST', { provider: 'amazon_seller', config })
    setBusy(false)
    if (!ok) return setToast({ ok: false, text: data.error || 'Failed to save credentials' })
    setToast({ ok: true, text: 'Amazon Seller credentials saved. Use Test connection to check them.' })
    setManual(false)
    setF(AMAZON_EMPTY)
    onDone()
  }

  const fields: Array<{ k: keyof typeof f; label: string; hint?: string; secret?: boolean }> = [
    {
      k: 'seller_id',
      label: 'Seller ID (Merchant Token)',
      hint: 'Seller Central > Settings > Account Info > Your Merchant Token.',
    },
    { k: 'client_id', label: 'LWA client ID', hint: 'From your SP-API app in Seller Central > Develop Apps.' },
    { k: 'client_secret', label: 'LWA client secret', secret: true },
    {
      k: 'refresh_token',
      label: 'Refresh token',
      hint: 'Starts with Atzr|. Shown after self-authorizing the app.',
      secret: true,
    },
    { k: 'marketplace_id', label: 'Marketplace ID (optional)', hint: 'Defaults to Amazon.in (A21TJRUUN4KGV).' },
  ]

  return (
    <CardShell title="Amazon Seller" subtitle="List your products on Amazon.in." connected={connected}>
      {connected && (
        <div className="space-y-0.5">
          <Detail label="Seller ID" value={row?.meta?.seller_id} />
          <Detail label="Marketplace" value={row?.meta?.marketplace_id} />
          <Detail label="Method" value={viaLabel(row?.meta?.connected_via, 'Seller Central authorization')} />
        </div>
      )}
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
        <>
          {oauth?.enabled ? null : <OAuthUnavailable provider="Amazon" oauth={oauth} />}
          <div className="flex flex-wrap items-center gap-2">
            {oauth?.enabled && (
              <a href="/api/admin/integrations/amazon/connect" className={btnPrimary}>
                {connected ? 'Reconnect with Amazon' : 'Connect with Amazon'}
              </a>
            )}
            <button type="button" onClick={() => setManual(o => !o)} className={btnSecondary}>
              {manual ? 'Hide manual entry' : 'Enter credentials'}
            </button>
            {connected && <TestButton provider="amazon_seller" setToast={setToast} />}
            {connected && (
              <DisconnectButton
                url="/api/admin/integrations"
                body={{ provider: 'amazon_seller' }}
                onDone={onDone}
                setToast={setToast}
              />
            )}
          </div>
          {manual && (
            <div className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4">
              {fields.map(fl => (
                <Field key={fl.k} label={fl.label} hint={fl.hint}>
                  <input
                    value={f[fl.k]}
                    onChange={set(fl.k)}
                    type={fl.secret ? 'password' : 'text'}
                    autoComplete="off"
                    className={inputCls}
                  />
                </Field>
              ))}
              <button
                onClick={save}
                disabled={busy || !f.client_id || !f.client_secret || !f.refresh_token || !f.seller_id}
                className={btnPrimary}
              >
                {busy ? 'Saving…' : 'Save credentials'}
              </button>
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}

function MetaCard({
  fb,
  ig,
  oauth,
  canWrite,
  onDone,
  setToast,
}: {
  fb?: SocialRow
  ig?: SocialRow
  oauth?: OAuthInfo
  canWrite: boolean
  onDone: () => void
  setToast: SetToast
}) {
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ page_id: '', access_token: '', ig_user_id: '' })
  const connected = !!fb || !!ig
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  async function save() {
    setBusy(true)
    setToast(null)
    const { ok, data } = await postJson('/api/admin/social/accounts', 'POST', {
      page_id: f.page_id.trim(),
      access_token: f.access_token.trim(),
      ig_user_id: f.ig_user_id.trim(),
    })
    setBusy(false)
    if (!ok) return setToast({ ok: false, text: data.error || 'Failed to save credentials' })
    setToast({
      ok: true,
      text: `Connected to ${data.page_name || 'the Page'}${data.instagram ? ' and its Instagram account' : ''}.`,
    })
    setManual(false)
    setF({ page_id: '', access_token: '', ig_user_id: '' })
    onDone()
  }

  return (
    <CardShell
      title="Meta (Facebook & Instagram)"
      subtitle="Auto-post new products to your pages."
      connected={connected}
    >
      <div className="space-y-0.5">
        <Detail label="Facebook Page" value={fb ? fb.page_name || fb.page_id || 'Connected' : null} />
        <Detail label="Instagram" value={ig ? `linked via ${ig.page_name || 'Page'}` : null} />
      </div>
      {!canWrite ? (
        <p className="text-xs text-foreground-muted">You don&apos;t have permission to change these credentials.</p>
      ) : (
        <>
          {oauth?.enabled ? null : <OAuthUnavailable provider="Facebook" oauth={oauth} />}
          <div className="flex flex-wrap items-center gap-2">
            {oauth?.enabled && (
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/api/admin/social/connect/facebook'
                }}
                className={btnPrimary}
              >
                {connected ? 'Reconnect with Facebook' : 'Connect with Facebook'}
              </button>
            )}
            <button type="button" onClick={() => setManual(o => !o)} className={btnSecondary}>
              {manual ? 'Hide manual entry' : 'Enter Page token'}
            </button>
            {connected && <TestButton provider="meta" setToast={setToast} />}
            {connected && <DisconnectButton url="/api/admin/social/accounts" onDone={onDone} setToast={setToast} />}
          </div>
          {manual && (
            <div className="space-y-3 rounded-xl border border-border-default bg-surface-elevated p-4">
              <Field label="Facebook Page ID" hint="Page > About > Page transparency, or the id in the Page URL.">
                <input value={f.page_id} onChange={set('page_id')} inputMode="numeric" className={inputCls} />
              </Field>
              <Field
                label="Page access token"
                hint="A long-lived Page token with pages_manage_posts (and instagram_content_publish for Instagram), e.g. from a Business Manager system user."
              >
                <input
                  value={f.access_token}
                  onChange={set('access_token')}
                  type="password"
                  autoComplete="off"
                  className={inputCls}
                />
              </Field>
              <Field label="Instagram business account ID (optional)" hint="Read from the Page when blank.">
                <input value={f.ig_user_id} onChange={set('ig_user_id')} inputMode="numeric" className={inputCls} />
              </Field>
              <button
                onClick={save}
                disabled={busy || !f.page_id.trim() || !f.access_token.trim()}
                className={btnPrimary}
              >
                {busy ? 'Checking…' : 'Save and verify'}
              </button>
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}
