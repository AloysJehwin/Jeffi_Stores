'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Link2, Loader2 } from 'lucide-react'
import type { AdsConnectionStatus } from '@/lib/google-ads/connection'
import { formatCid } from '@/lib/google-ads/format'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface AccountOption {
  customerId: string
  name: string | null
  currency: string | null
  testAccount: boolean
  loginCustomerId: string | null
  managerName: string | null
}

const input =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40'
const btnPrimary =
  'inline-flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50'
const btnGhost =
  'inline-flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50'

type Method = 'google' | 'manual' | 'manager' | 'platform'

/** Env/setup state shown when the platform side is not ready. */
export function NotConfigured({ status }: { status: AdsConnectionStatus }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <AlertCircle className="w-5 h-5" />
        <h2 className="font-semibold">Google Ads is not configured on this platform</h2>
      </div>
      <ul className="text-sm text-foreground-secondary space-y-1">
        <li>
          Developer token (GOOGLE_ADS_DEVELOPER_TOKEN): {status.env.developerToken ? 'set' : <b>missing</b>}
        </li>
        <li>Google OAuth client (GOOGLE_OAUTH_CLIENT_ID / _SECRET): {status.env.oauthClient ? 'set' : <b>missing</b>}</li>
        <li>
          Platform manager account (GOOGLE_ADS_LOGIN_CUSTOMER_ID, optional):{' '}
          {status.env.managerId ? formatCid(status.env.managerId) : 'not set'}
          {status.env.managerId && !status.env.managerRefreshToken ? ' (GOOGLE_ADS_MANAGER_REFRESH_TOKEN missing)' : ''}
        </li>
      </ul>
      <p className="text-xs text-foreground-muted">
        Redirect URI on the Google OAuth client (the same one Merchant Center uses): <code className="break-all">{status.oauth.redirectUri}</code>
      </p>
    </div>
  )
}

export default function ConnectPanel({
  status,
  onChanged,
}: {
  status: AdsConnectionStatus
  onChanged: (s: AdsConnectionStatus | null) => void
}) {
  const [method, setMethod] = useState<Method>('google')
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null)
  const [skipped, setSkipped] = useState<{ customerId: string; reason: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [manual, setManual] = useState({ customerId: '', loginCustomerId: '', refreshToken: '' })
  const [managed, setManaged] = useState('')
  const canWrite = useCanWrite('google_ads')

  useEffect(() => {
    if (!status.pendingAccount) return
    setBusy(true)
    fetch('/api/admin/google-ads/accounts', { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not list accounts')
        setAccounts(d.accounts ?? [])
        setSkipped(d.skipped ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setBusy(false))
  }, [status.pendingAccount])

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch('/api/admin/google-ads/connection', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not connect')
      if (d.invited) setNotice(d.message)
      else onChanged(d.status ?? null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const disabled = !status.env.developerToken || !canWrite
  const tabs: { id: Method; label: string; show: boolean }[] = [
    { id: 'google', label: 'Sign in with Google', show: true },
    { id: 'manual', label: 'Enter manually', show: true },
    { id: 'manager', label: 'Managed by the platform', show: !!status.env.managerId && status.env.managerRefreshToken },
    { id: 'platform', label: 'Platform service account', show: status.flagship },
  ]

  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Connect Google Ads</h2>
        <p className="text-sm text-foreground-secondary mt-1">
          Read-only reporting: spend, clicks and conversions next to the orders and margins in your store. Nothing is
          changed in your Google Ads account.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border-default">
        {tabs
          .filter(t => t.show)
          .map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMethod(t.id)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${
                method === t.id ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {method === 'google' && (
        <div className="space-y-3">
          {!status.pendingAccount ? (
            <>
              <p className="text-sm text-foreground-secondary">
                Sign in with a Google user that can open your Google Ads account. If an agency or manager account manages
                it, you can pick it under that manager.
              </p>
              <a
                href={disabled || !status.oauth.enabled ? undefined : '/api/admin/integrations/google-ads/connect'}
                aria-disabled={disabled || !status.oauth.enabled}
                className={`${btnPrimary} ${disabled || !status.oauth.enabled ? 'pointer-events-none opacity-50' : ''}`}
              >
                <Link2 className="w-4 h-4" /> Connect with Google
              </a>
              {!status.oauth.enabled && (
                <p className="text-xs text-foreground-muted">Missing: {status.oauth.missing.join(', ')}</p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-foreground-secondary">Signed in. Choose the Google Ads account to report on:</p>
              {busy && !accounts && (
                <p className="text-sm text-foreground-muted flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…
                </p>
              )}
              {accounts && accounts.length === 0 && (
                <p className="text-sm text-foreground-muted">No advertiser accounts are reachable with this sign-in.</p>
              )}
              <ul className="divide-y divide-border-default rounded-lg border border-border-default">
                {(accounts ?? []).map(a => (
                  <li key={`${a.loginCustomerId ?? ''}${a.customerId}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {a.name || 'Unnamed account'} <span className="text-foreground-muted">{formatCid(a.customerId)}</span>
                      </p>
                      <p className="text-xs text-foreground-muted">
                        {a.currency || ''}
                        {a.testAccount ? ' · test account' : ''}
                        {a.loginCustomerId ? ` · via manager ${a.managerName || ''} ${formatCid(a.loginCustomerId)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !canWrite}
                      className={btnGhost}
                      onClick={() => post({ action: 'select', customerId: a.customerId, loginCustomerId: a.loginCustomerId })}
                    >
                      Use this account
                    </button>
                  </li>
                ))}
              </ul>
              {skipped.length > 0 && (
                <details className="text-xs text-foreground-muted">
                  <summary>{skipped.length} account(s) could not be read</summary>
                  <ul className="mt-1 space-y-1">
                    {skipped.map(s => (
                      <li key={s.customerId}>
                        {formatCid(s.customerId)}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {method === 'manual' && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={e => {
            e.preventDefault()
            post({ action: 'manual', ...manual, loginCustomerId: manual.loginCustomerId || null })
          }}
        >
          <label className="text-sm space-y-1">
            <span className="text-foreground-secondary">Customer id</span>
            <input
              className={input}
              placeholder="123-456-7890"
              value={manual.customerId}
              onChange={e => setManual(m => ({ ...m, customerId: e.target.value }))}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-foreground-secondary">Manager id (login customer id, optional)</span>
            <input
              className={input}
              placeholder="Only if a manager account grants access"
              value={manual.loginCustomerId}
              onChange={e => setManual(m => ({ ...m, loginCustomerId: e.target.value }))}
            />
          </label>
          <label className="text-sm space-y-1 sm:col-span-2">
            <span className="text-foreground-secondary">OAuth refresh token (adwords scope, issued to the platform OAuth client)</span>
            <input
              className={input}
              type="password"
              autoComplete="off"
              value={manual.refreshToken}
              onChange={e => setManual(m => ({ ...m, refreshToken: e.target.value }))}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={btnPrimary} disabled={busy || disabled}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Verify and save
            </button>
          </div>
        </form>
      )}

      {method === 'manager' && (
        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault()
            post({ action: 'manager', customerId: managed, invite: true })
          }}
        >
          <p className="text-sm text-foreground-secondary">
            The platform manager account {formatCid(status.env.managerId)} reads your account for you. If it is not linked
            yet, we send a link request you accept in Google Ads (Admin, Access and security, Managers).
          </p>
          <input
            className={`${input} max-w-xs`}
            placeholder="Your customer id, 123-456-7890"
            value={managed}
            onChange={e => setManaged(e.target.value)}
          />
          <div>
            <button type="submit" className={btnPrimary} disabled={busy || disabled}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Link account
            </button>
          </div>
        </form>
      )}

      {method === 'platform' && (
        <div className="space-y-2 text-sm text-foreground-secondary">
          <p>
            The flagship can read its own Google Ads account with the platform Google service account (the one
            the Merchant Center sync uses), with no sign-in:
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              In Google Ads, open Admin, Access and security, Users, and add{' '}
              <code className="break-all">{status.serviceAccountEmail || 'the platform service account'}</code> with
              Standard (or Read only) access. Add it on the manager account instead if one manages the store.
            </li>
            <li>
              Set GOOGLE_ADS_CUSTOMER_ID to the account&apos;s customer id
              {status.env.platformCustomerId ? ` (now ${formatCid(status.env.platformCustomerId)})` : ' (not set)'}, and
              GOOGLE_ADS_LOGIN_CUSTOMER_ID to the manager id when going through one.
            </li>
          </ol>
          <p className="text-xs text-foreground-muted">
            A connection made with the other options takes precedence; disconnect it to fall back to this.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-green-700 dark:text-green-400 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {notice}
        </p>
      )}
    </div>
  )
}
