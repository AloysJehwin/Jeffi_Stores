'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, KeyRound } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { REVIEW_TIME } from '@controller/lib/ecom/console-copy'
import { SandTableLoading } from '../_components/Skeleton'
import { Card } from '../_components/Card'
import { EmptyState } from '../_components/EmptyState'
import { ChoiceChips, fieldCls } from '../../_ui'
import { fieldRow, primaryBtn } from '../../onboard/ui'

const KEY_COLUMNS = ['Name', 'Key', 'Scopes', '30-day use', 'Last used', '']

interface Key { id: string; name: string; key_prefix: string; scopes: string[]; status: string; last_used_at: string | null; created_at: string; requests_30d: number; spend_paise_30d: string }
const SCOPES: [string, string, 'messaging' | 'documents' | null][] = [
  ['messages:send', 'Send messages', 'messaging'], ['templates:read', 'Read templates', 'messaging'], ['templates:write', 'Manage templates', 'messaging'],
  ['documents:render', 'Render documents', 'documents'], ['documents:read', 'Read documents', 'documents'], ['wallet:read', 'Read wallet balance', null],
]

const LABEL = { messaging: 'Messaging', documents: 'Documents' } as const

// A service still under review is announced by the dashboard layout's banner, on every page. Services are requested on
// the Services page only, where the business verification is checked first.
export default function ApiKeysClient({ services, approved, docsUrl }: { services: { messaging: boolean; documents: boolean }; approved: boolean; docsUrl: string }) {
  const { showToast } = useToast()
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(SCOPES.filter(([, , s]) => !s || services[s]).map(([k]) => k))
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => fetch('/api/ecom/api-keys').then(r => r.json()).then(d => setKeys(d.keys ?? [])).catch(() => setKeys([]))
  useEffect(() => { load() }, [])

  async function create() {
    setBusy(true)
    const r = await fetch('/api/ecom/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, scopes }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok) { setCreated(d.key); setName(''); load() } else showToast(d.error || 'Could not create the key. Try again.', 'error')
  }
  async function revoke(id: string) {
    await fetch(`/api/ecom/api-keys/${id}`, { method: 'DELETE' }); load()
  }
  const other: 'messaging' | 'documents' = services.messaging ? 'documents' : 'messaging'
  const noService = !services.messaging && !services.documents
  return (
    <div className="space-y-6">
      {!noService && (!services.messaging || !services.documents) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl org-sand px-5 py-3 text-sm">
          <span>Also need the {LABEL[other]} API? Add it on Services.</span>
          <Link href="/dashboard/services" className="text-sm font-semibold ecom-accent-text hover:underline">Go to Services</Link>
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
            <button onClick={create} disabled={busy || name.length < 1 || scopes.length === 0} className={`${primaryBtn} ${fieldRow}`}>Create key</button>
          </div>
          <ChoiceChips multiple ariaLabel="Scopes" className="mt-4" value={scopes} onChange={setScopes}
            options={SCOPES.filter(([, , s]) => !s || services[s]).map(([k, l]) => ({ value: k, label: l }))} />
        </Card>
      )}

      <Card title="Keys">
        {keys === null ? <SandTableLoading columns={KEY_COLUMNS} rows={3} /> : keys.length === 0 ? (
          <EmptyState
            bare
            icon={KeyRound}
            title="No keys yet"
            action={approved ? undefined : { href: '/dashboard/services', label: noService ? 'Add a service' : 'Go to Services' }}
          >
            {noService
              ? 'Keys come with a service. Add Messaging or Documents on Services; your keys work once Jeffi approves it.'
              : approved
                ? 'Create one above to start calling the API.'
                : `Create one above. It works once Jeffi approves your service, usually within ${REVIEW_TIME}.`}
          </EmptyState>
        ) : (
          <div className="-mx-6 -mb-6 overflow-x-auto"><table className="w-full text-sm min-w-[640px]"><thead className="org-sand text-foreground-secondary"><tr>{KEY_COLUMNS.map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border-default">{keys.map(k => <tr key={k.id} className={k.status === 'revoked' ? 'opacity-50' : ''}><td className="px-6 py-2.5 font-medium">{k.name}</td><td className="px-6 py-2.5 font-mono text-xs">{k.key_prefix}…</td><td className="px-6 py-2.5 text-xs text-foreground-secondary">{k.scopes.length} scopes</td><td className="px-6 py-2.5 text-xs">{k.requests_30d} req · ₹{(Number(k.spend_paise_30d) / 100).toFixed(2)}</td><td className="px-6 py-2.5 text-xs text-foreground-secondary">{k.last_used_at ? new Date(k.last_used_at).toLocaleString('en-IN') : '—'}</td><td className="px-6 py-2.5 text-right">{k.status === 'active' ? <button onClick={() => revoke(k.id)} className="text-xs text-[#8a2e1f] hover:underline">Revoke</button> : <span className="text-xs">Revoked</span>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <p className="text-sm text-foreground-secondary">
        Full reference and quick-starts:{' '}
        <a href={`${docsUrl}/docs`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 org-brown font-semibold hover:underline">
          API documentation <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </a>
      </p>
    </div>
  )
}
