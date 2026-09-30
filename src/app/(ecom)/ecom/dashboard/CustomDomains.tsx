'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Domain {
  id: string
  domain: string
  status: string
  verification_token: string | null
}

export default function CustomDomains({
  tenantId,
  slug,
  maxDomains,
}: {
  tenantId: string
  slug: string
  maxDomains: number
}) {
  const { showToast } = useToast()
  const [domains, setDomains] = useState<Domain[]>([])
  const [cnameTarget, setCnameTarget] = useState(`${slug}.jeffistores.in`)
  const [newDomain, setNewDomain] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch(`/api/ecom/domains?tenantId=${tenantId}`)
      .then(r => r.json())
      .catch(() => null)
    if (res?.domains) {
      setDomains(res.domains)
      if (res.cnameTarget) setCnameTarget(res.cnameTarget)
    }
  }
  useEffect(() => {
    load()
  }, [tenantId])

  async function addDomain() {
    setBusy(true)
    const res = await fetch('/api/ecom/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, domain: newDomain }),
    })
    const data = await res.json()
    if (!res.ok) {
      showToast(data.error, 'error')
      setBusy(false)
      return
    }
    setNewDomain('')
    showToast(data.instructions, 'info')
    await load()
    setBusy(false)
  }

  async function verify(id: string) {
    setBusy(true)
    const res = await fetch(`/api/ecom/domains/${id}/verify`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) showToast(data.error, 'error')
    else showToast(data.message, 'success')
    await load()
    setBusy(false)
  }

  if (maxDomains === 0) {
    return (
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
        <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-2">Custom domain</div>
        <p className="text-sm text-foreground-secondary">
          Available on Pro plan and above. Upgrade to connect your own domain.
        </p>
      </div>
    )
  }

  const statusColor: Record<string, string> = {
    verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    verifying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-foreground-secondary uppercase tracking-widest">Custom domains</div>
        <span className="text-xs text-foreground-secondary">
          {domains.length}/{maxDomains} used
        </span>
      </div>

      {domains.map(d => (
        <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-border-default/60 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-foreground truncate">{d.domain}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor[d.status] ?? ''}`}>
              {d.status}
            </span>
          </div>
          {d.status !== 'verified' && (
            <button
              onClick={() => verify(d.id)}
              disabled={busy}
              className="text-xs px-3 py-1 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
            >
              Verify
            </button>
          )}
        </div>
      ))}

      {domains.length < maxDomains && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <input
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              placeholder="shop.yourbrand.com"
              className="flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <button
              onClick={addDomain}
              disabled={busy || !newDomain}
              className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              Add
            </button>
          </div>
          <p className="text-xs text-foreground-secondary">
            Point a CNAME record to <span className="font-mono text-foreground">{cnameTarget}</span>, then click Verify.
          </p>
        </div>
      )}
    </div>
  )
}
