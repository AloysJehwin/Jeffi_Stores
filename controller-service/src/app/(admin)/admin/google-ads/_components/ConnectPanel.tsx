'use client'

import { useEffect, useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { inputCls, btnPrimary, btnGhost } from '@/components/admin/kit/core'
import { AlertCircle, CheckCircle2, ExternalLink, Link2, Loader2 } from 'lucide-react'
import type { AdsConnectionStatus } from '@/lib/google-ads/connection'
import { formatCid } from '@/lib/google-ads/format'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Tabs } from '@/components/admin/channels/ui'

interface AccountOption {
  customerId: string
  name: string | null
  currency: string | null
  testAccount: boolean
  loginCustomerId: string | null
  managerName: string | null
}

const input = inputCls

type Method = 'google' | 'manual' | 'manager' | 'create' | 'platform'

/** Env/setup state shown when the platform side is not ready. */
export function NotConfigured({ status }: { status: AdsConnectionStatus }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <AlertCircle className="w-5 h-5" />
        <h2 className="font-semibold">Google Ads is not configured on this platform</h2>
      </div>
      <ul className="text-sm text-foreground-secondary space-y-1 break-words">
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
  const toast = useActionToast()
  const [manual, setManual] = useState({ customerId: '', loginCustomerId: '', refreshToken: '' })
  const [managed, setManaged] = useState('')
  const canWrite = useCanWrite('google_ads')
  const canCreate = useCanWrite('google_ads_campaigns')

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
    try {
      const r = await fetch('/api/admin/google-ads/connection', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not connect')
      if (d.invited) toast.success(d.message)
      else onChanged(d.status ?? null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Drops the pending sign-in and starts Google's sign-in again with the account chooser.
  async function useAnotherAccount() {
    setBusy(true)
    setError(null)
    const r = await fetch('/api/admin/google-ads/connection', { method: 'DELETE', credentials: 'include' }).catch(() => null)
    if (r && !r.ok) {
      setError((await r.json().catch(() => ({}))).error || 'Could not clear the sign-in')
      setBusy(false)
      return
    }
    window.location.href = '/api/admin/integrations/google-ads/connect'
  }

  const disabled = !status.env.developerToken || !canWrite
  const tabs: { id: Method; label: string; show: boolean }[] = [
    { id: 'google', label: 'Sign in with Google', show: true },
    { id: 'manual', label: 'Enter manually', show: true },
    { id: 'manager', label: 'Managed by the platform', show: !!status.env.managerId && status.env.managerRefreshToken },
    { id: 'create', label: 'Create a new account', show: !!status.env.managerId && status.env.managerRefreshToken },
    { id: 'platform', label: 'Platform service account', show: status.flagship },
  ]

  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Connect Google Ads</h2>
        <p className="text-sm text-foreground-secondary mt-1">
          Reporting: spend, clicks and conversions next to the orders and margins in your store. Connecting changes
          nothing in your Google Ads account; on Pro and up you can also create and edit campaigns from here.
        </p>
      </div>

      <Tabs tabs={tabs.filter(t => t.show)} value={method} onChange={setMethod} />

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
                <p className="text-xs text-foreground-muted">
                  Sign-in needs {status.oauth.missing.join(', ')} on the platform, with redirect URI{' '}
                  <code className="break-all">{status.oauth.redirectUri}</code>.
                </p>
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
                <p className="text-sm text-foreground-muted">
                  No usable Google Ads account is reachable with this sign-in. Sign in with the Google user that has access to
                  your Google Ads account (or its manager account).
                </p>
              )}
              <ul className="divide-y divide-border-default rounded-lg border border-border-default">
                {(accounts ?? []).map(a => (
                  <li key={`${a.loginCustomerId ?? ''}${a.customerId}`} className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3 py-2">
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
              {canWrite && (
                <button type="button" disabled={busy} className={`${btnGhost} !h-auto py-1.5 !whitespace-normal sm:!h-control sm:py-0 sm:!whitespace-nowrap`} onClick={useAnotherAccount}>
                  <Link2 className="w-4 h-4" /> Sign in with a different Google account
                </button>
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

      {method === 'create' && (canCreate ? <CreateAccount status={status} onDone={onChanged} /> : (
        <p className="text-sm text-foreground-secondary">Creating a Google Ads account for your store is part of Google Ads campaign management on the Pro plan.</p>
      ))}

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
    </div>
  )
}

interface Created {
  customerId: string
  name: string
  invitation: { email: string; sent: boolean; error: string | null } | null
  billingUrl: string
  status: AdsConnectionStatus
}

const BILLING_TEXT: Record<string, string> = {
  APPROVED: 'Billing is set up (monthly invoicing).',
  APPROVED_HELD: 'Billing is approved; the first account budget is waiting for approval.',
  PENDING: 'Billing setup is waiting for Google to approve it.',
  CANCELLED: 'The billing setup was cancelled.',
  NONE: 'No billing found yet. Card payments are not visible to the API, so check Billing in Google Ads if you already added one.',
}

/** A new account under the platform manager (INR, Asia/Kolkata), then the billing steps the store does in Google Ads. */
function CreateAccount({ status, onDone }: { status: AdsConnectionStatus; onDone: (s: AdsConnectionStatus | null) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [billing, setBilling] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/google-ads/account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, inviteEmail: email.trim() || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create the account')
      setCreated(d)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function checkBilling() {
    setBusy(true)
    const r = await fetch('/api/admin/google-ads/billing', { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    setBilling(r.ok ? BILLING_TEXT[d.status] ?? d.status : d.error || 'Could not read billing')
  }

  if (created) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-start gap-2 text-green-700 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> Created {created.name} {formatCid(created.customerId)} (INR, India time), managed by the platform account.
        </p>
        {created.invitation?.sent && (
          <p className="text-foreground-secondary">An Admin invitation went to {created.invitation.email}. Accept it from that inbox to open the account in Google Ads.</p>
        )}
        {created.invitation && !created.invitation.sent && (
          <p className="text-amber-700 dark:text-amber-400">The invitation to {created.invitation.email} failed: {created.invitation.error}</p>
        )}
        <div className="rounded-lg border border-border-default p-3 space-y-2">
          <p className="font-medium text-foreground">Add a payment method before ads can run</p>
          <ol className="list-decimal pl-5 space-y-1 text-foreground-secondary">
            <li>Open Google Ads with the invited Google account and switch to {formatCid(created.customerId)}.</li>
            <li>Go to Billing, then Settings, and add your card or bank details. Charges go to your payment method, not Jeffi.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <a href={created.billingUrl} target="_blank" rel="noreferrer" className={btnGhost}>
              Billing in Google Ads <ExternalLink className="w-4 h-4" />
            </a>
            <button type="button" className={btnGhost} disabled={busy} onClick={checkBilling}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Check billing
            </button>
          </div>
          {billing && <p className="text-xs text-foreground-muted">{billing}</p>}
        </div>
        <button type="button" className={btnPrimary} onClick={() => onDone(created.status)}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <form
      className="space-y-3"
      onSubmit={e => {
        e.preventDefault()
        create()
      }}
    >
      <p className="text-sm text-foreground-secondary">
        No Google Ads account yet? We create one for your store under the platform manager account {formatCid(status.env.managerId)}, in Indian rupees
        on India time (both are fixed once created). You then add your own payment method in Google Ads.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm space-y-1">
          <span className="text-foreground-secondary">Account name</span>
          <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Your store name" />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-foreground-secondary">Your Google account email (gets Admin access, to add billing)</span>
          <input className={input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" />
        </label>
      </div>
      <button type="submit" className={`${btnPrimary} !h-auto py-1.5 !whitespace-normal sm:!h-control sm:py-0 sm:!whitespace-nowrap`} disabled={busy || !name.trim()}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create a Google Ads account for this store
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </form>
  )
}
