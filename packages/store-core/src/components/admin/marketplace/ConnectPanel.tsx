'use client'

import { useState } from 'react'
import { KeyRound, PackagePlus, RefreshCw, Unplug } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import IconButton from '@/components/ui/IconButton'
import { CopyValue } from '@/components/admin/kit/actions'
import { Badge, api, btnGhost, btnPrimary, inputCls, when, type Tone } from '@/components/admin/channels/ui'
import { useActionToast } from '@/components/admin/kit/toast'
import type { MarketplaceConnectionStatus } from '@/lib/marketplace/connection-route'

type Channel = MarketplaceConnectionStatus['channel']
type Mode = 'mock' | 'sandbox' | 'live'

const LABEL: Record<Channel, string> = { myntra: 'Myntra', ajio: 'AJIO' }
const MODE_OPTIONS = [
  { value: 'mock', label: 'Mock', hint: 'Simulated orders for trying the flow; nothing is sent' },
  { value: 'sandbox', label: 'Sandbox', hint: 'The marketplace test environment' },
  { value: 'live', label: 'Live', hint: 'Real orders, stock and listings' },
]
const MODE_TONE: Record<Mode, Tone> = { mock: 'muted', sandbox: 'amber', live: 'green' }

export const modeBadge = (mode: Mode | null) => (mode ? <Badge tone={MODE_TONE[mode]}>{mode[0].toUpperCase() + mode.slice(1)}</Badge> : null)

/** Credentials, mode, push URL and token for a marketplace. Field list comes from the status
 * (MARKETPLACE_FIELDS on the server), so secret values never reach the browser. */
export default function ConnectPanel({
  status,
  canWrite,
  onChanged,
  token: tokenProp,
  onToken,
}: {
  status: MarketplaceConnectionStatus
  canWrite: boolean
  onChanged: (msg?: string) => void
  /** A just-generated push token, held by the parent so it survives this panel remounting. */
  token?: string | null
  onToken?: (token: string) => void
}) {
  const ch = status.channel
  const name = LABEL[ch]
  const url = `/api/admin/${ch}/connection`
  const [mode, setMode] = useState<Mode>(status.mode ?? 'mock')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(status.fields.map(f => [f.key, f.secret ? '' : f.value ?? '']))
  )
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const [localToken, setLocalToken] = useState<string | null>(null)
  const token = tokenProp !== undefined ? tokenProp : localToken
  const setToken = onToken ?? setLocalToken

  const call = async (key: string, path: string, init: RequestInit & { json?: unknown }) => {
    setBusy(key)
    const r = await api(path, init)
    setBusy(null)
    if (!r.ok) toast.error(r.data.error || 'Request failed')
    return r
  }
  const body = { mode, fields: values }

  const test = async () => {
    const r = await call('test', `${url}?action=test`, { method: 'POST', json: body })
    if (r.ok) toast.result({ ok: !!r.data.ok, text: r.data.ok ? `${name} accepted these details.` : r.data.message || `${name} did not accept these details.` })
  }
  const save = async () => {
    const r = await call('save', url, { method: 'POST', json: body })
    if (!r.ok) return
    setValues(v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, status.fields.find(f => f.key === k)?.secret ? '' : x])))
    if (r.data.pushToken) setToken(r.data.pushToken)
    onChanged(`${name} ${status.connected ? 'connection updated' : 'connected'}.`)
  }
  const rotate = async () => {
    const r = await call('rotate', `${url}?action=rotate-token`, { method: 'POST' })
    if (!r.ok) return
    setToken(r.data.pushToken)
    onChanged('New push token generated. Send it to your account manager; the old one works for 24 hours.')
  }
  const testOrder = async () => {
    const r = await call('order', `${url}?action=test-order`, { method: 'POST' })
    if (r.ok) onChanged(r.data.orderNumber ? `Test order ${r.data.orderNumber} received.` : 'Test order received.')
  }
  const disconnect = async () => {
    const r = await call('disconnect', url, { method: 'DELETE' })
    if (r.ok) onChanged(`${name} disconnected. Imported orders and listings are kept.`)
  }

  const changed = status.fields.some(f => (f.secret ? !!values[f.key] : (values[f.key] ?? '') !== (f.value ?? ''))) || mode !== status.mode
  const testMode = status.connected && status.mode !== 'live'

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {status.fields.map(f => (
            <label key={f.key} className="min-w-0 text-xs text-foreground-muted">
              {f.label}
              <input
                className={inputCls}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                disabled={!canWrite}
                placeholder={f.secret && f.set ? 'Saved. Leave blank to keep it.' : f.placeholder ?? undefined}
                value={values[f.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <AdminSelect
            label="Mode"
            value={mode}
            onChange={v => setMode(v as Mode)}
            options={MODE_OPTIONS}
            disabled={!canWrite}
            hint={MODE_OPTIONS.find(o => o.value === mode)?.hint}
          />
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} disabled={!!busy} onClick={test}>
              {busy === 'test' ? 'Testing...' : 'Test'}
            </button>
            <button type="button" className={btnPrimary} disabled={!!busy || (status.connected && !changed)} onClick={save}>
              {busy === 'save' ? 'Saving...' : status.connected ? 'Save' : 'Save and connect'}
            </button>
            {status.connected && (
              <button type="button" className={`${btnGhost} text-red-600`} disabled={!!busy} onClick={disconnect}>
                <Unplug className="w-4 h-4" /> Disconnect
              </button>
            )}
          </div>
        )}
      </div>

      {status.connected && (
        <div className="space-y-3 rounded-xl border border-border-default p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">Order push</p>
            {modeBadge(status.mode)}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted">Push URL</p>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 break-all text-xs text-foreground">{status.pushUrl}</code>
              <CopyValue value={status.pushUrl} label="Copy push URL" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted">Push token</p>
            {token ? (
              <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 break-all text-xs text-foreground">{token}</code>
                  <CopyValue value={token} label="Copy push token" />
                </div>
                <p className="text-xs text-foreground-muted">Copy it now. It is not shown again.</p>
              </div>
            ) : (
              <p className="text-xs text-foreground-secondary">
                {status.hasPushToken ? `Set${status.pushTokenRotatedAt ? ` on ${when(status.pushTokenRotatedAt)}` : ''}. Rotate to see a new one.` : 'Not set yet.'}
              </p>
            )}
            {status.previousTokenValidUntil && (
              <p className="text-xs text-foreground-muted">The previous token keeps working until {when(status.previousTokenValidUntil)}.</p>
            )}
            {canWrite && (
              <button type="button" className={`${btnGhost} mt-1`} disabled={!!busy} onClick={rotate}>
                <KeyRound className="w-4 h-4" /> {busy === 'rotate' ? 'Rotating...' : status.hasPushToken ? 'Rotate token' : 'Generate token'}
              </button>
            )}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-foreground-secondary">
            <li>Copy the push URL and the push token.</li>
            <li>Send both to your {name} account manager and ask them to register them for order push.</li>
            <li>
              {status.mode === 'live'
                ? `Once registered, new ${name} orders arrive here on their own.`
                : 'Send a test order to try the flow; the last event time below updates when it arrives.'}
            </li>
            <li>Switch the mode to Live after a successful test.</li>
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">
              Last event: {status.lastEventAt ? when(status.lastEventAt) : 'none yet'}
            </p>
            <div className="flex flex-wrap gap-2">
              <IconButton icon={RefreshCw} label="Refresh status" onClick={() => onChanged()} />
              {canWrite && testMode && (
                <button type="button" className={btnGhost} disabled={!!busy} onClick={testOrder}>
                  <PackagePlus className="w-4 h-4" /> {busy === 'order' ? 'Sending...' : 'Send test order'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
