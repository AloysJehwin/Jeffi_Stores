'use client'

import { useState, useEffect } from 'react'
import { SkeletonRows } from './_components/Skeleton'
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
  const [loaded, setLoaded] = useState(false)
  const [cnameTarget, setCnameTarget] = useState(`${slug}.jeffistores.in`)
  const [aRecord, setARecord] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [busy, setBusy] = useState(false)

  async function del(id: string) {
    if (!confirm('Remove this domain?')) return
    setBusy(true)
    const res = await fetch(`/api/ecom/domains/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) showToast(data.error ?? 'Failed to delete', 'error')
    await load()
    setBusy(false)
  }

  async function load() {
    const res = await fetch(`/api/ecom/domains?tenantId=${tenantId}`)
      .then(r => r.json())
      .catch(() => null)
    setLoaded(true)
    if (res?.domains) {
      setDomains(res.domains)
      if (res.cnameTarget) setCnameTarget(res.cnameTarget)
      setARecord(res.aRecord ?? null)
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

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Waiting for DNS',
    'dns-verified': 'Waiting for pointing record',
    'cert-pending': 'Issuing certificate',
    verified: 'Live',
    failed: 'Failed',
    expired: 'Expired',
  }
  // Failed and expired claims don't hold a slot (custom-domains.ts).
  const used = domains.filter(d => d.status !== 'failed' && d.status !== 'expired').length

  const statusColor: Record<string, string> = {
    verified: 'org-sage org-sage-text',
    verifying: 'org-sand org-brown',
    pending: 'org-peach org-brown',
    'dns-verified': 'org-sand org-brown',
    'cert-pending': 'org-peach org-brown',
    failed: 'bg-[#f2d4cd] text-[#8a2e1f]',
    expired: 'bg-[#f2d4cd] text-[#8a2e1f]',
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-foreground-secondary uppercase tracking-widest">Custom domains</div>
        <span className="text-xs text-foreground-secondary">
          {used}/{maxDomains} used
        </span>
      </div>

      {!loaded && <SkeletonRows rows={2} cols={3} />}
      {domains.map(d => (
        <div key={d.id} className="py-2.5 border-b border-border-default/60 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-foreground truncate">{d.domain}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor[d.status] ?? ''}`}>
                {STATUS_LABEL[d.status] ?? d.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {d.status !== 'verified' && (
                <button
                  onClick={() => verify(d.id)}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded-xl border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  Verify
                </button>
              )}
              <button
                onClick={() => del(d.id)}
                disabled={busy}
                className="text-xs px-3 py-1 rounded-xl border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
          {(d.status === 'pending' || d.status === 'dns-verified') && (
            <ol className="mt-1 text-xs text-foreground-secondary list-decimal pl-4 space-y-0.5">
              {d.status === 'pending' && d.verification_token && (
                <li>
                  TXT <span className="font-mono text-foreground">_jeffi.{d.domain}</span> ={' '}
                  <span className="font-mono text-foreground break-all">{d.verification_token}</span>
                </li>
              )}
              <li>
                CNAME <span className="font-mono text-foreground">{d.domain}</span> →{' '}
                <span className="font-mono text-foreground break-all">{cnameTarget}</span>
                {aRecord && (
                  <>
                    {' '}(root domain: A record → <span className="font-mono text-foreground">{aRecord}</span>)
                  </>
                )}
              </li>
            </ol>
          )}
          {(d.status === 'failed' || d.status === 'expired') && (
            <div className="mt-1 text-xs text-foreground-secondary">Delete it and add it again once the DNS records are in place.</div>
          )}
        </div>
      ))}

      {used < maxDomains && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <input
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              placeholder="shop.yourbrand.com"
              className="flex-1 rounded-xl border border-border-default bg-surface px-3 py-2 text-sm text-foreground ecom-field"
            />
            <button
              onClick={addDomain}
              disabled={busy || !newDomain}
              className="px-4 py-2 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              Add
            </button>
          </div>
          <p className="text-xs text-foreground-secondary">
            After adding, create two DNS records at your provider:
          </p>
          <ol className="text-xs text-foreground-secondary list-decimal pl-4 space-y-1">
            <li>
              A <span className="font-mono text-foreground">TXT</span> record at{' '}
              <span className="font-mono text-foreground break-all">_jeffi.&lt;domain&gt;</span> set to the token
              shown above — this proves you own the domain and is what Verify checks.
            </li>
            <li>
              A record that points the domain itself at{' '}
              <span className="font-mono text-foreground break-all">{cnameTarget}</span> — a{' '}
              <span className="font-mono text-foreground">CNAME</span> for a subdomain
              (e.g. <span className="font-mono text-foreground">shop.yourbrand.com</span>)
              {aRecord ? (
                <>
                  , or an <span className="font-mono text-foreground">A</span> record to{' '}
                  <span className="font-mono text-foreground">{aRecord}</span> for a root domain.
                </>
              ) : (
                '.'
              )}
            </li>
          </ol>
          <p className="text-xs text-foreground-secondary">Then click Verify. We check every 10 minutes too, and issue the certificate once the domain points at us.</p>
        </div>
      )}
    </div>
  )
}
