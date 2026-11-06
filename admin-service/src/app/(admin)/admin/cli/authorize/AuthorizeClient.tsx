'use client'

import { useState } from 'react'
import { Card, PageHeader } from '@/components/admin/kit/layout'
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

  return (
    <div className="px-4 sm:px-6 pt-4 sm:pt-6 space-y-5 max-w-2xl">
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
        <Card title="Sign-in request">
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="text-foreground-muted">Code shown in your terminal</span>
              <input
                className={`${inputCls} mt-1 font-mono tracking-widest uppercase`}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="XXXX-XXXX"
                maxLength={9}
                autoComplete="off"
              />
            </label>
            {pending ? (
              <p className="text-xs text-foreground-muted">
                {pending.clientName || 'jeffi CLI'}
                {pending.clientIp ? ` from ${pending.clientIp}` : ''}, requested {when(pending.createdAt)}. Expires {when(pending.expiresAt)}.
              </p>
            ) : initialCode ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">No live request has this code. It may have expired; run jeffi login again.</p>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="text-sm text-foreground-muted">Access</legend>
              {(
                [
                  ['read', 'Read only', 'Every :read permission you hold'],
                  ['all', 'Everything you can do', 'Follows your permissions, including later changes'],
                  ['custom', 'Specific scopes', 'A list such as products:write orders:read'],
                ] as const
              ).map(([id, label, hint]) => (
                <label key={id} className="flex items-start gap-2 text-sm text-foreground">
                  <input type="radio" name="preset" checked={preset === id} onChange={() => setPreset(id)} className="mt-1" />
                  <span>
                    {label}
                    <span className="block text-xs text-foreground-muted">{hint}</span>
                  </span>
                </label>
              ))}
              {preset === 'custom' && (
                <input className={`${inputCls} font-mono`} value={custom} onChange={e => setCustom(e.target.value)} placeholder="products:write orders:read" />
              )}
            </fieldset>

            <label className="block text-sm">
              <span className="text-foreground-muted">Valid for</span>
              <select className={`${inputCls} mt-1`} value={ttl} onChange={e => setTtl(e.target.value)}>
                {TTLS.filter(t => !(administrator && t.id === '7d')).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {administrator && <span className="mt-1 block text-xs text-foreground-muted">Platform administrator tokens last at most 24 hours.</span>}
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} disabled={busy || !code} onClick={() => decide('approve')}>
                Approve
              </button>
              <button type="button" className={btnGhost} disabled={busy || !code} onClick={() => decide('deny')}>
                Deny
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
