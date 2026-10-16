'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, RefreshCw, Unlink } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { formatCid, money } from '@/lib/google-ads/format'
import type { ManagedAccount } from '@/lib/google-ads/manager-view'

// Client accounts under the Jeffi manager account: the store each belongs to, status, spend over
// the last 30 days, and unlink.

const humanize = (s: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase() : '-')

export default function ManagedAccountsClient({ managerId, configured }: { managerId: string | null; configured: boolean }) {
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    setError(null)
    const r = await fetch('/api/admin/ecom/google-ads', { credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return setError(d.error || 'Could not read the manager account')
    setAccounts(d.accounts ?? [])
  }, [])

  useEffect(() => {
    if (configured) load()
  }, [configured, load])

  async function unlink(cid: string) {
    setBusy(cid)
    setNotice(null)
    const r = await fetch(`/api/admin/ecom/google-ads/${cid}`, { method: 'DELETE', credentials: 'include' })
    const d = await r.json().catch(() => ({}))
    setBusy(null)
    setConfirm(null)
    if (!r.ok) return setError(d.error || 'Could not unlink the account')
    setNotice(`Unlinked ${formatCid(cid)}.${d.disconnected?.length ? ` Disconnected: ${d.disconnected.map((s: any) => s.name).join(', ')}.` : ''}`)
    load()
  }

  const total = (accounts ?? []).reduce((s, a) => s + (a.spend30d ?? 0), 0)
  return (
    <div className="p-6 w-full space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Google Ads accounts</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Client accounts under the platform manager {managerId ? formatCid(managerId) : ''}
            {accounts ? ` · ${accounts.length} accounts · ${money(total, 'INR')} spent in the last 30 days` : ''}
          </p>
        </div>
        {configured && <IconButton icon={RefreshCw} label="Refresh" busy={busy === 'load'} onClick={load} />}
      </div>
      {!configured && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (the manager account) and GOOGLE_ADS_MANAGER_REFRESH_TOKEN to manage store accounts.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
      {accounts && (
        <div className="overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Spend (30 days)</th>
                <th className="px-3 py-2 text-right">Clicks</th>
                <th className="px-3 py-2 text-right">Conversions</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {!accounts.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-foreground-muted">
                    No client accounts under the manager yet.
                  </td>
                </tr>
              )}
              {accounts.map(a => (
                <tr key={a.customerId} className="border-t border-border-default/60">
                  <td className="px-3 py-2">
                    <span className="font-medium">{a.name || 'Unnamed'}</span> <span className="text-foreground-muted">{formatCid(a.customerId)}</span>
                    {a.testAccount && <span className="ml-1 text-xs text-foreground-muted">(test)</span>}
                  </td>
                  <td className="px-3 py-2">{a.stores.length ? a.stores.map(s => s.name).join(', ') : <span className="text-foreground-muted">Not connected to a store</span>}</td>
                  <td className="px-3 py-2 capitalize">
                    {humanize(a.status)}
                    {a.linkStatus && a.linkStatus !== 'ACTIVE' ? ` · link ${humanize(a.linkStatus)}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" title={a.spendError ?? undefined}>
                    {a.spend30d == null ? (a.spendError ? 'error' : '-') : money(a.spend30d, a.currency || 'INR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.clicks30d ?? '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.conversions30d == null ? '-' : Math.round(a.conversions30d * 10) / 10}</td>
                  <td className="px-3 py-2 text-right">
                    {confirm === a.customerId ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        Unlink{a.stores.length ? ' and disconnect the store' : ''}?
                        <button type="button" className="rounded-md bg-red-600 px-2 py-1 text-white" disabled={!!busy} onClick={() => unlink(a.customerId)}>
                          Unlink
                        </button>
                        <button type="button" className="text-foreground-muted" onClick={() => setConfirm(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <IconButton icon={Unlink} label="Unlink from the manager" variant="danger" busy={busy === a.customerId} onClick={() => setConfirm(a.customerId)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
