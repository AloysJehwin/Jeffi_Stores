'use client'

import { useEffect, useState } from 'react'
import { SkeletonRows } from '../_components/Skeleton'
import { Card } from '../_components/Card'
import { ChoiceChips, fieldCls } from '../../_ui'

interface Key { id: string; name: string; key_prefix: string; scopes: string[]; status: string; last_used_at: string | null; created_at: string; requests_30d: number; spend_paise_30d: string }
const SCOPES: [string, string, 'messaging' | 'documents' | null][] = [
  ['messages:send', 'Send messages', 'messaging'], ['templates:read', 'Read templates', 'messaging'], ['templates:write', 'Manage templates', 'messaging'],
  ['documents:render', 'Render documents', 'documents'], ['documents:read', 'Read documents', 'documents'], ['wallet:read', 'Read wallet balance', null],
]

const LABEL = { messaging: 'Messaging', documents: 'Documents' } as const

// A service still under review is announced by the dashboard layout's banner, on every page.
export default function ApiKeysClient({ services, docsUrl }: { services: { messaging: boolean; documents: boolean }; docsUrl: string }) {
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(SCOPES.filter(([, , s]) => !s || services[s]).map(([k]) => k))
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [confirm, setConfirm] = useState<'messaging' | 'documents' | null>(null)

  const load = () => fetch('/api/ecom/api-keys').then(r => r.json()).then(d => setKeys(d.keys ?? [])).catch(() => setKeys([]))
  useEffect(() => { load() }, [])

  async function create() {
    setBusy(true)
    const r = await fetch('/api/ecom/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, scopes }) })
    const d = await r.json()
    setBusy(false)
    if (r.ok) { setCreated(d.key); setName(''); load() } else alert(d.error)
  }
  async function revoke(id: string) {
    await fetch(`/api/ecom/api-keys/${id}`, { method: 'DELETE' }); load()
  }
  async function request(s: 'messaging' | 'documents') {
    setEnabling(true)
    await fetch('/api/ecom/services/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services: [s] }) })
    location.reload()
  }
  const other: 'messaging' | 'documents' = services.messaging ? 'documents' : 'messaging'
  const confirmBox = (s: 'messaging' | 'documents') => (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-surface-elevated px-4 py-3 text-sm">
      <span>Request the {LABEL[s]} API? We review requests the same business day and email you when it&apos;s on.</span>
      <button disabled={enabling} onClick={() => request(s)} className="ecom-accent-bg rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{enabling ? 'Sending…' : 'Send request'}</button>
      <button onClick={() => setConfirm(null)} className="text-xs font-semibold text-foreground-secondary hover:text-foreground">Cancel</button>
    </div>
  )

  const noService = !services.messaging && !services.documents
  return (
    <div className="space-y-6">
      {noService && (
        <Card title="Request a service">
          <p className="text-sm text-foreground-secondary mb-4">Your workspace has no API services yet. Request one — it uses the same wallet as your store and starts after a quick review.</p>
          <div className="flex flex-wrap gap-3">{(['messaging', 'documents'] as const).map(s => <button key={s} onClick={() => setConfirm(s)} className="ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white">Request {LABEL[s]} API</button>)}</div>
          {confirm && confirmBox(confirm)}
        </Card>
      )}
      {!noService && (!services.messaging || !services.documents) && (
        <div className="rounded-2xl org-sand px-5 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span>Also need the {LABEL[other]} API?</span>
            {confirm !== other && <button onClick={() => setConfirm(other)} className="rounded-full border border-border-default px-4 py-1.5 text-xs font-semibold hover:bg-surface-elevated">Request {LABEL[other]} API</button>}
          </div>
          {confirm === other && confirmBox(other)}
        </div>
      )}

      {created && (
        <div className="rounded-[2rem] org-peach p-6">
          <p className="font-display font-black text-xl">Your new key</p>
          <p className="text-sm text-foreground-secondary mt-1">Copy it now — it will not be shown again.</p>
          <code className="block mt-3 rounded-xl bg-surface-elevated px-4 py-3 text-sm break-all select-all">{created}</code>
          <pre className="mt-4 rounded-xl bg-[#2a2822] text-[#f3ead9] p-4 text-xs overflow-x-auto">{`curl ${docsUrl}/v1/messages \\
  -H "Authorization: Bearer ${created}" \\
  -H "Content-Type: application/json" \\
  -d '${services.messaging
    ? '{"channel":"sms","to":"+91<your mobile number>","template":"otp/login","variables":{"code":"4821","ttl_minutes":"10"}}'
    : '{"seller":{"name":"Your Store","state":"Karnataka"},"buyer":{"name":"Priya Sharma","state":"Tamil Nadu"},"items":[{"description":"Cordless drill","quantity":1,"unit_price":6499}]}'}'`.replace('/v1/messages', services.messaging ? '/v1/messages' : '/v1/documents/invoice')}</pre>
          <p className="mt-2 text-xs text-foreground-secondary">Replace the number with yours to receive it. Every template and its variables are listed under Messaging → Templates (Send via API).</p>
          <button onClick={() => setCreated(null)} className="mt-4 text-sm org-brown font-semibold hover:underline">Done</button>
        </div>
      )}

      {!noService && (
        <Card title="Create a key">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
            <label className="block"><span className="text-xs text-foreground-muted">Name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Production backend" className={`mt-1 w-full rounded-xl bg-surface-elevated px-4 py-2.5 text-sm ${fieldCls}`} /></label>
            <button onClick={create} disabled={busy || name.length < 1 || scopes.length === 0} className="ecom-accent-bg rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Create key</button>
          </div>
          <ChoiceChips multiple ariaLabel="Scopes" className="mt-4" value={scopes} onChange={setScopes}
            options={SCOPES.filter(([, , s]) => !s || services[s]).map(([k, l]) => ({ value: k, label: l }))} />
        </Card>
      )}

      <Card title="Keys">
        {keys === null ? <SkeletonRows rows={3} cols={5} /> : keys.length === 0 ? <p className="text-sm text-foreground-secondary">No keys yet.</p> : (
          <div className="-mx-6 -mb-6 overflow-x-auto"><table className="w-full text-sm min-w-[640px]"><thead className="org-sand text-foreground-secondary"><tr>{['Name', 'Key', 'Scopes', '30-day use', 'Last used', ''].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border-default">{keys.map(k => <tr key={k.id} className={k.status === 'revoked' ? 'opacity-50' : ''}><td className="px-6 py-2.5 font-medium">{k.name}</td><td className="px-6 py-2.5 font-mono text-xs">{k.key_prefix}…</td><td className="px-6 py-2.5 text-xs text-foreground-secondary">{k.scopes.length} scopes</td><td className="px-6 py-2.5 text-xs">{k.requests_30d} req · ₹{(Number(k.spend_paise_30d) / 100).toFixed(2)}</td><td className="px-6 py-2.5 text-xs text-foreground-secondary">{k.last_used_at ? new Date(k.last_used_at).toLocaleString('en-IN') : '—'}</td><td className="px-6 py-2.5 text-right">{k.status === 'active' ? <button onClick={() => revoke(k.id)} className="text-xs text-[#8a2e1f] hover:underline">Revoke</button> : <span className="text-xs">Revoked</span>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <p className="text-sm text-foreground-secondary">Full reference and quick-starts: <a href={`${docsUrl}/docs`} target="_blank" rel="noreferrer" className="org-brown font-semibold hover:underline">{docsUrl}/docs →</a></p>
    </div>
  )
}
