'use client'

import { useCallback, useEffect, useState } from 'react'
import { Unplug } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Badge, Section, api, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/channels/ui'
import type { NetworkInfo } from './shared'

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'muted'> = { connected: 'green', pending: 'amber', not_connected: 'muted' }
const META = new Set(['facebook', 'instagram'])

export default function Accounts({ networks, autoPick, onChange }: { networks: NetworkInfo[] | null; autoPick: string | null; onChange: () => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [picking, setPicking] = useState<string | null>(autoPick)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (autoPick) setPicking(autoPick)
  }, [autoPick])

  async function disconnect(network: string) {
    setBusy(network)
    const r = await api(`/api/admin/social/networks/${network}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Could not disconnect', 'error')
    else showToast('Disconnected', 'success')
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
                {n.target && <span className="text-sm text-foreground-secondary">{n.target}</span>}
                {n.tokenExpiry && <span className="text-xs text-foreground-muted">expires {when(n.tokenExpiry)}</span>}
                <span className="text-xs text-foreground-muted">
                  {[n.features.insights && 'insights', n.features.inbox && 'inbox', n.features.reply && 'replies'].filter(Boolean).join(', ')}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {meta ? (
                    <span className="text-xs text-foreground-muted">Connect or change with the Facebook and Instagram button at the top of the page.</span>
                  ) : canWrite && n.configured ? (
                    <>
                      {n.status === 'pending' && (
                        <button type="button" className={btnGhost} onClick={() => setPicking(p => (p === n.network ? null : n.network))}>
                          Choose where to post
                        </button>
                      )}
                      <a href={`/api/admin/social/networks/${n.network}/connect`} className={n.status === 'connected' ? btnGhost : btnPrimary}>
                        {n.status === 'not_connected' ? 'Connect' : 'Reconnect'}
                      </a>
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
                </div>
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

function TargetPicker({ network, label, onDone }: { network: string; label: string; onDone: (chosen: boolean) => void }) {
  const canWrite = useCanWrite('social')
  const { showToast } = useToast()
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [saving, setSaving] = useState(false)
  const url = `/api/admin/social/networks/${network}`

  const load = useCallback(async () => {
    const r = await api<{ targets: { id: string; name: string }[] }>(url)
    if (r.ok) {
      setTargets(r.data.targets ?? [])
      setId(r.data.targets?.[0]?.id ?? '')
    } else setError(r.data.error || 'Could not load')
  }, [url])
  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    const r = await api(url, { method: 'POST', json: { id } })
    setSaving(false)
    if (!r.ok) return showToast(r.data.error || 'Could not save', 'error')
    showToast(`${label} connected`, 'success')
    onDone(true)
  }

  if (!canWrite) return null
  return (
    <div className="rounded-lg bg-surface-secondary p-3 space-y-2">
      <p className="text-sm">Where should {label} posts go?</p>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !targets ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !targets.length ? (
        <p className="text-sm text-foreground-muted">This sign-in has nothing to post to. Sign in with another account.</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <select className={inputCls + ' max-w-sm'} value={id} onChange={e => setId(e.target.value)}>
            {targets.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" className={btnPrimary} disabled={saving || !id} onClick={save}>
            {saving ? 'Saving...' : 'Use this'}
          </button>
          <button type="button" className={btnGhost} onClick={() => onDone(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
