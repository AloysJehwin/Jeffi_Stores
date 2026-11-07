'use client'

import { useState } from 'react'
import { Card, PageBody, PageHeader } from '@/components/admin/kit/layout'
import { btnGhost, btnPrimary, inputCls, when } from '@/components/admin/kit/core'
import type { PendingDevice } from '@/lib/auth/api-tokens'

type Preset = 'read' | 'all' | 'custom'
const TTLS = [
  { id: '1h', label: '1 hour' },
  { id: '12h', label: '12 hours' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
]

// Approving a CLI login acts on the admin's own identity: the token never exceeds their grant.
export default function AuthorizeClient({
  initialCode,
  pending,
  administrator,
  scopeHint,
  customScopes,
  ttlHint,
}: {
  initialCode: string
  pending: PendingDevice | null
  administrator: boolean
  scopeHint: '' | Preset
  customScopes: string
  ttlHint: string
}) {
  const [code, setCode] = useState(initialCode)
  const [preset, setPreset] = useState<Preset>(scopeHint || 'read')
  const [custom, setCustom] = useState(customScopes)
  const [ttl, setTtl] = useState(ttlHint && !(administrator && ttlHint === '7d') ? ttlHint : '12h')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | { status: 'approved' | 'denied'; expiresAt?: string; scopes?: string[] }>(null)
  const [error, setError] = useState('')

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true)
    setError('')
    const scopes = preset === 'custom' ? custom.split(/[\s,]+/).filter(Boolean) : preset
    const r = await fetch('/api/admin/cli/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify({ user_code: code, decision, scopes, ttl }),
    })
    const data = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setError(data.error || `Failed (HTTP ${r.status})`)
    setDone({ status: data.status, expiresAt: data.expires_at, scopes: data.scopes })
  }

  const tile = (on: boolean) =>
    `flex h-full cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors ${
      on ? 'border-accent-500/50 bg-accent-500/10' : 'border-border-default hover:bg-surface-secondary'
    }`

  const details = pending ? (
    <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-foreground-muted">Client</dt>
      <dd className="min-w-0 break-words text-foreground">{pending.clientName || 'jeffi CLI'}</dd>
      {pending.clientIp && (
        <>
          <dt className="text-foreground-muted">From</dt>
          <dd className="font-mono text-foreground">{pending.clientIp}</dd>
        </>
      )}
      {pending.userAgent && (
        <>
          <dt className="text-foreground-muted">Agent</dt>
          <dd className="min-w-0 break-words text-xs text-foreground">{pending.userAgent}</dd>
        </>
      )}
      <dt className="text-foreground-muted">Requested</dt>
      <dd className="text-foreground">{when(pending.createdAt)}</dd>
      <dt className="text-foreground-muted">Expires</dt>
      <dd className="text-foreground">{when(pending.expiresAt)}</dd>
    </dl>
  ) : (
    <p className="text-sm text-foreground-muted">
      {initialCode ? 'No live request has this code. It may have expired; run jeffi login again.' : 'Enter the code your terminal shows to see who is asking.'}
    </p>
  )

  return (
    <PageBody>
      <PageHeader title="Authorize the command line" description="A terminal running jeffi login asked to sign in to this store as you. Approve it only if you started it." />
      {done ? (
        <Card>
          {done.status === 'approved' ? (
            <div className="space-y-2 text-sm text-foreground">
              <p className="font-semibold">Approved. You can return to your terminal.</p>
              <p className="text-foreground-muted">
                {done.scopes?.includes('*') ? 'Everything you can do' : `${done.scopes?.length ?? 0} scope(s)`} until {when(done.expiresAt)}. Revoke it any time under Settings → CLI &amp; tokens.
              </p>
            </div>
          ) : (
            <p className="text-sm text-foreground">Denied. The terminal will report it.</p>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <Card title="Code">
              <label className="block text-sm">
                <span className="text-foreground-muted">Code shown in your terminal</span>
                <input
                  className={`${inputCls} mt-1 max-w-xs font-mono text-lg tracking-widest uppercase`}
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  autoComplete="off"
                />
              </label>
            </Card>

            <Card title="Access">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {(
                  [
                    ['read', 'Read only', 'Every :read permission you hold'],
                    ['all', 'Everything you can do', 'Follows your permissions, including later changes'],
                    ['custom', 'Specific scopes', 'A list such as products:write orders:read'],
                  ] as const
                ).map(([id, label, hint]) => (
                  <label key={id} className={tile(preset === id)}>
                    <input type="radio" name="preset" checked={preset === id} onChange={() => setPreset(id)} className="mt-1" />
                    <span>
                      <span className="font-medium text-foreground">{label}</span>
                      <span className="block text-xs text-foreground-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {preset === 'custom' && (
                <input className={`${inputCls} mt-3 font-mono`} value={custom} onChange={e => setCustom(e.target.value)} placeholder="products:write orders:read" />
              )}
            </Card>

            <Card title="Valid for">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {TTLS.filter(t => !(administrator && t.id === '7d')).map(t => (
                  <label key={t.id} className={tile(ttl === t.id)}>
                    <input type="radio" name="ttl" checked={ttl === t.id} onChange={() => setTtl(t.id)} className="mt-1" />
                    <span className="font-medium text-foreground">{t.label}</span>
                  </label>
                ))}
              </div>
              {administrator && <p className="mt-2 text-xs text-foreground-muted">Platform administrator tokens last at most 24 hours.</p>}
            </Card>

            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy || !code} onClick={() => decide('approve')}>
                Approve
              </button>
              <button type="button" className={btnGhost} disabled={busy || !code} onClick={() => decide('deny')}>
                Deny
              </button>
            </div>
          </div>

          <div className="min-w-0 space-y-5">
            <Card title="Request">{details}</Card>
            <Card title="After you approve">
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-foreground-muted">
                <li>The terminal signs in as you; the token never gets more than your own permissions.</li>
                <li>
                  Check it with <code className="font-mono text-foreground">jeffi whoami</code>.
                </li>
                <li>Revoke it any time under Settings → CLI &amp; tokens, or with jeffi logout.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </PageBody>
  )
}
