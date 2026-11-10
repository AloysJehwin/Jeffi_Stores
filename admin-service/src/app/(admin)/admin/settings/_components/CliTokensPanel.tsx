'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/admin/kit/layout'
import { LoadingTable } from '@/components/admin/kit/skeleton'
import { Badge, btnGhost, when } from '@/components/admin/kit/core'
import { EmptyState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { useConfirm } from '@/contexts/ConfirmContext'

interface TokenRow {
  id: string
  kind: 'cli' | 'extension' | 'service_account'
  status: string
  scopes: string[]
  clientName: string | null
  clientIp: string | null
  prefix: string | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  holder: string | null
  mine: boolean
  live: boolean
}

const KIND = { cli: 'CLI', extension: 'Extension', service_account: 'Service account key' } as const

// Settings → CLI & tokens: your `jeffi login` and extension tokens; the store's owner also sees everyone's
// and the service-account keys. Revoking acts on the member's own credentials (owners: anyone's).
export default function CliTokensPanel({ owner }: { owner: boolean }) {
  const [rows, setRows] = useState<TokenRow[] | null>(null)
  const [all, setAll] = useState(owner)
  const [error, setError] = useState('')
  const toast = useActionToast()
  const confirm = useConfirm()

  const load = useCallback(async () => {
    setError('')
    const r = await fetch(`/api/admin/cli/tokens${all ? '?all=1' : ''}`, { credentials: 'include' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return setError(data.error || `Could not load tokens (HTTP ${r.status})`)
    setRows(data.tokens ?? [])
  }, [all])

  useEffect(() => {
    void load()
  }, [load])

  async function revoke(t: TokenRow) {
    const ok = await confirm({
      message: t.kind === 'service_account' ? `Revoke ${t.holder ?? 'this service account'}'s API key? Calls with it stop at once.` : 'Revoke this token? The CLI or extension using it is signed out.',
      variant: 'danger',
      confirmLabel: 'Revoke',
    })
    if (!ok) return
    const r = await fetch(`/api/admin/cli/tokens/${t.id}`, { method: 'DELETE', headers: { 'x-requested-with': 'fetch' } })
    const data = await r.json().catch(() => ({}))
    toast.result({ ok: r.ok, data }, { success: 'Revoked' })
    if (r.ok) void load()
  }

  const live = rows?.filter(r => r.live) ?? []
  const past = rows?.filter(r => !r.live) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Card
        title="CLI & tokens"
        hint={
          <>
            Sign in from a terminal with <code className="font-mono">jeffi login</code>. A token never does more than its holder can, and stops working when revoked or expired.
          </>
        }
        action={
          owner ? (
            <label className="flex items-center gap-2 text-xs text-foreground-muted">
              <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
              Everyone&apos;s, with service-account keys
            </label>
          ) : undefined
        }
        flush
      >
        {error ? (
          <p className="px-5 pb-5 text-sm text-red-500">{error}</p>
        ) : !rows ? (
          <LoadingTable bare rows={4} columns={['Token', 'Access', 'Last used', 'Expires', '']} />
        ) : rows.length === 0 ? (
          <EmptyState bare title="No tokens" body="Run jeffi login in a terminal, or copy an extension token from the Account tab." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                  <th className="px-5 py-2 font-medium">Token</th>
                  {all && <th className="px-3 py-2 font-medium">Holder</th>}
                  <th className="px-3 py-2 font-medium">Access</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...live, ...past].map(t => (
                  <tr key={t.id} className={`border-b border-border-default last:border-0 ${t.live ? '' : 'opacity-60'}`}>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={t.kind === 'service_account' ? 'blue' : 'muted'}>{KIND[t.kind]}</Badge>
                        <span className="font-mono text-xs text-foreground-secondary">{t.prefix}…</span>
                      </div>
                      <div className="mt-0.5 text-xs text-foreground-muted">
                        {t.clientName || '-'}
                        {t.clientIp ? ` · ${t.clientIp}` : ''} · created {when(t.createdAt)}
                      </div>
                    </td>
                    {all && <td className="px-3 py-2 text-foreground">{t.holder ?? '-'}{t.mine ? ' (you)' : ''}</td>}
                    <td className="px-3 py-2 text-foreground-secondary">{t.scopes.includes('*') ? 'Everything the holder can do' : `${t.scopes.length} scope(s)`}</td>
                    <td className="px-3 py-2 text-foreground-secondary">{when(t.lastUsedAt)}</td>
                    <td className="px-3 py-2 text-foreground-secondary">{t.revokedAt ? `Revoked ${when(t.revokedAt)}` : t.expiresAt ? when(t.expiresAt) : 'Never'}</td>
                    <td className="px-5 py-2 text-right">
                      {t.live && (t.mine || owner) && (
                        <button type="button" className={btnGhost} onClick={() => revoke(t)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
