'use client'

import { useCallback, useEffect, useState } from 'react'
import { Unplug } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import Select from '@/components/ui/Select'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, Section, api, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/channels/ui'
import type { NetworkInfo } from './shared'

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'muted'> = { connected: 'green', pending: 'amber', not_connected: 'muted' }
const META = new Set(['facebook', 'instagram'])

/** What the target id is on each network, for the manual form and the picker. */
const TARGET_FIELD: Record<string, { label: string; placeholder: string }> = {
  gbp: { label: 'Location ID', placeholder: 'accounts/123/locations/456' },
  youtube: { label: 'Channel ID', placeholder: 'UCxxxxxxxxxxxxxxxxxxxxxx' },
  pinterest: { label: 'Board ID', placeholder: '549755885175' },
  linkedin: { label: 'Organization URN', placeholder: 'urn:li:organization:12345' },
  x: { label: 'User ID', placeholder: '1234567890' },
}
const targetField = (network: string) => TARGET_FIELD[network] ?? { label: 'Target ID', placeholder: '' }

export default function Accounts({ networks, autoPick, onChange }: { networks: NetworkInfo[] | null; autoPick: string | null; onChange: () => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [picking, setPicking] = useState<string | null>(autoPick)
  const [manual, setManual] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (autoPick) setPicking(autoPick)
  }, [autoPick])

  async function disconnect(network: string) {
    setBusy(network)
    const r = await api(`/api/admin/social/networks/${network}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Could not disconnect', 'error')
    else {
      showToast('Disconnected', 'success')
      setNotice(({ [network]: _, ...rest }) => rest)
    }
    onChange()
  }

  if (!networks) return <p className="text-sm text-foreground-muted">Loading...</p>

  return (
    <Section title="Connected accounts">
      <ul className="divide-y divide-border-default">
        {networks.map(n => {
          const meta = META.has(n.network)
          return (
            <li key={n.network} className="py-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium w-40">{n.label}</span>
                <Badge tone={STATUS_TONE[n.status] ?? 'red'}>{n.status.replace('_', ' ')}</Badge>
                {n.status !== 'not_connected' && n.via === 'manual' && <Badge>{n.ownApp ? 'manual, own app' : 'manual'}</Badge>}
                {n.target && <span className="text-sm text-foreground-secondary">{n.target}</span>}
                {n.tokenExpiry && <span className="text-xs text-foreground-muted">expires {when(n.tokenExpiry)}</span>}
                <span className="text-xs text-foreground-muted">
                  {[n.features.insights && 'insights', n.features.inbox && 'inbox', n.features.reply && 'replies'].filter(Boolean).join(', ')}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {meta ? (
                    <span className="text-xs text-foreground-muted">Connect or change with the Facebook and Instagram button at the top of the page.</span>
                  ) : canWrite ? (
                    <>
                      {n.status === 'pending' && (
                        <button type="button" className={btnGhost} onClick={() => setPicking(p => (p === n.network ? null : n.network))}>
                          Choose where to post
                        </button>
                      )}
                      <button type="button" className={btnGhost} onClick={() => setManual(m => (m === n.network ? null : n.network))}>
                        Enter credentials
                      </button>
                      {n.configured && (
                        <a href={`/api/admin/social/networks/${n.network}/connect`} className={n.status === 'connected' ? btnGhost : btnPrimary}>
                          {n.status === 'not_connected' ? 'Connect' : 'Reconnect'}
                        </a>
                      )}
                      {n.status !== 'not_connected' && (
                        <IconButton icon={Unplug} variant="danger" label="Disconnect" busy={busy === n.network} onClick={() => disconnect(n.network)} />
                      )}
                    </>
                  ) : null}
                </div>
              </div>
              {!meta && !n.configured && (
                <div className="text-xs text-foreground-muted rounded-lg bg-surface-secondary p-2 space-y-1">
                  <p>
                    {n.label} sign-in is not set up on this platform yet. It needs: <span className="font-mono">{n.missing.join(', ')}</span>.
                  </p>
                  {n.redirectUri && (
                    <p>
                      Redirect URI to register with {n.label}: <span className="font-mono break-all">{n.redirectUri}</span>
                    </p>
                  )}
                  {canWrite && manual !== n.network && <p>You can still connect by entering credentials from your own {n.label} app.</p>}
                </div>
              )}
              {notice[n.network] && <p className="text-xs text-amber-600 rounded-lg bg-surface-secondary p-2">{notice[n.network]}</p>}
              {canWrite && manual === n.network && !meta && (
                <ManualCredentials
                  info={n}
                  onDone={(saved, warning) => {
                    if (!saved) return setManual(null)
                    setManual(null)
                    setPicking(p => (p === n.network ? null : p))
                    setNotice(prev => {
                      const { [n.network]: _, ...rest } = prev
                      return warning ? { ...rest, [n.network]: warning } : rest
                    })
                    onChange()
                  }}
                />
              )}
              {canWrite && picking === n.network && !meta && (
                <TargetPicker
                  network={n.network}
                  label={n.label}
                  onDone={chosen => {
                    setPicking(null)
                    if (chosen) onChange()
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function ManualCredentials({ info, onDone }: { info: NetworkInfo; onDone: (saved: boolean, warning?: string) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [f, setF] = useState({ accessToken: '', refreshToken: '', clientId: '', clientSecret: '', targetId: '', targetName: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  const target = targetField(info.network)
  const pairBroken = !!f.clientId.trim() !== !!f.clientSecret.trim()

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ warning?: string }>(`/api/admin/social/networks/${info.network}/manual`, { method: 'POST', json: f })
      if (!r.ok) return setError(r.data.error || 'Could not save')
      showToast(`${info.label} connected`, 'success')
      onDone(true, r.data.warning)
    } catch (e: any) {
      setError(String(e?.message ?? 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) return null
  return (
    <div className="rounded-lg bg-surface-secondary p-3 space-y-2">
      <p className="text-sm">Enter {info.label} credentials</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs space-y-1 sm:col-span-2">
          <span>Access token</span>
          <input type="password" autoComplete="off" className={inputCls} value={f.accessToken} onChange={set('accessToken')} />
        </label>
        <label className="text-xs space-y-1 sm:col-span-2">
          <span>Refresh token (optional)</span>
          <input type="password" autoComplete="off" className={inputCls} value={f.refreshToken} onChange={set('refreshToken')} />
        </label>
        <label className="text-xs space-y-1">
          <span>Your app Client ID {info.configured ? '(optional)' : ''}</span>
          <input autoComplete="off" className={inputCls} value={f.clientId} onChange={set('clientId')} />
        </label>
        <label className="text-xs space-y-1">
          <span>Your app Client Secret {info.configured ? '(optional)' : ''}</span>
          <input type="password" autoComplete="off" className={inputCls} value={f.clientSecret} onChange={set('clientSecret')} />
        </label>
        <p className="text-xs text-foreground-muted sm:col-span-2">
          {info.configured
            ? 'Add the Client ID and Secret of the app the token was issued to if it is not the platform app; refreshes then use your app.'
            : 'Without the Client ID and Secret of the app that issued the token, it cannot be refreshed: the access token will expire and need re-entering.'}
        </p>
        <label className="text-xs space-y-1">
          <span>{target.label}</span>
          <input className={inputCls} placeholder={target.placeholder} value={f.targetId} onChange={set('targetId')} />
        </label>
        <label className="text-xs space-y-1">
          <span>Display name (optional)</span>
          <input className={inputCls} value={f.targetName} onChange={set('targetName')} />
        </label>
      </div>
      {pairBroken && <p className="text-xs text-red-500">Enter both the Client ID and the Client Secret, or neither.</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} disabled={saving || !f.accessToken.trim() || !f.targetId.trim() || pairBroken} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className={btnGhost} onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function TargetPicker({ network, label, onDone }: { network: string; label: string; onDone: (chosen: boolean) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null)
  const [error, setError] = useState<{ message: string; hint?: string | null } | null>(null)
  const [id, setId] = useState('')
  const [typed, setTyped] = useState(false)
  const [manualId, setManualId] = useState('')
  const [manualName, setManualName] = useState('')
  const [saving, setSaving] = useState(false)
  const url = `/api/admin/social/networks/${network}`
  const field = targetField(network)

  const load = useCallback(async () => {
    try {
      const r = await api<{ targets: { id: string; name: string }[]; hint?: string | null }>(url)
      if (r.ok) {
        setTargets(r.data.targets ?? [])
        setId(r.data.targets?.[0]?.id ?? '')
      } else setError({ message: r.data.error || 'Could not load', hint: r.data.hint })
    } catch (e: any) {
      setError({ message: String(e?.message ?? 'Could not load') })
    }
  }, [url])
  useEffect(() => {
    load()
  }, [load])

  async function save(body: { id: string; name?: string }) {
    setSaving(true)
    try {
      const r = await api(url, { method: 'POST', json: body })
      if (!r.ok) return showToast(r.data.error || 'Could not save', 'error')
      showToast(`${label} connected`, 'success')
      onDone(true)
    } catch (e: any) {
      showToast(String(e?.message ?? 'Could not save'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) return null
  const showManual = typed || !!error || (targets !== null && !targets.length)
  return (
    <div className="rounded-lg bg-surface-secondary p-3 space-y-2">
      <p className="text-sm">Where should {label} posts go?</p>
      {error ? (
        <div className="space-y-1">
          <p className="text-sm text-red-500">{error.message}</p>
          {error.hint && <p className="text-sm text-amber-600">{error.hint}</p>}
        </div>
      ) : !targets ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !targets.length ? (
        <p className="text-sm text-foreground-muted">This sign-in has nothing to post to. Sign in with another account.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Select
            className="w-full max-w-sm"
            aria-label="Target"
            value={id}
            onChange={setId}
            options={targets.map(t => ({ value: t.id, label: t.name }))}
          />
          <button type="button" className={btnPrimary} disabled={saving || !id} onClick={() => save({ id })}>
            {saving ? 'Saving...' : 'Use this'}
          </button>
          {!typed && (
            <button type="button" className={btnGhost} onClick={() => setTyped(true)}>
              Enter the ID instead
            </button>
          )}
        </div>
      )}
      {showManual && (
        <div className="flex gap-2 flex-wrap items-end">
          <label className="text-xs space-y-1">
            <span>Enter the {field.label} instead</span>
            <input className={inputCls + ' max-w-sm'} placeholder={field.placeholder} value={manualId} onChange={e => setManualId(e.target.value)} />
          </label>
          <label className="text-xs space-y-1">
            <span>Display name (optional)</span>
            <input className={inputCls + ' max-w-xs'} value={manualName} onChange={e => setManualName(e.target.value)} />
          </label>
          <button type="button" className={btnPrimary} disabled={saving || !manualId.trim()} onClick={() => save({ id: manualId.trim(), name: manualName.trim() || undefined })}>
            {saving ? 'Saving...' : 'Use this ID'}
          </button>
        </div>
      )}
      <button type="button" className={btnGhost} onClick={() => onDone(false)}>
        Cancel
      </button>
    </div>
  )
}
