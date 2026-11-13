'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { Badge, ghostBtn, noteCls, primaryBtn, secondaryBtn } from '../onboard/ui'
import DomainSearch from '../_domains/DomainSearch'
import ContactFields from '../_domains/ContactFields'
import { contactProblem, EMPTY_CONTACT, fmtDate, inr, type DomainContact, type OwnerOrderView, type SearchResult } from '../_domains/types'
import { SkeletonRows } from './_components/Skeleton'

interface State {
  enabled: boolean
  orders: OwnerOrderView[]
  walletInr: number
  renewLeadDays: number
  renewCutoffDays: number
  contact: Partial<DomainContact>
}

const STEPS = ['Paid', 'Registered', 'DNS', 'Connected', 'HTTPS', 'Live']
const HOST_LABEL: Record<string, string> = {
  '': 'Store',
  www: 'Store (www)',
  admin: 'Admin panel',
  invoice: 'Invoices',
  quotation: 'Quotations',
  purchaseorder: 'Purchase orders',
  forms: 'Review forms',
  business: 'B2B portal',
  vault: 'Vault',
}
const POLLED = ['registering', 'configuring']

function stepIndex(o: OwnerOrderView): number {
  if (o.status === 'requested') return 0
  if (o.status === 'registering') return 1
  if (o.status === 'configuring') return ({ zone: 2, records: 2, routing: 3, certs: 4 } as Record<string, number>)[o.step ?? ''] ?? 2
  return STEPS.length
}

const STATUS: Record<string, { label: string; tone: 'sage' | 'peach' | 'red' | 'muted' }> = {
  requested: { label: 'Not bought yet', tone: 'peach' },
  registering: { label: 'Registering', tone: 'peach' },
  configuring: { label: 'Setting up', tone: 'peach' },
  active: { label: 'Live', tone: 'sage' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  expired: { label: 'Expired', tone: 'red' },
}

function Progress({ o }: { o: OwnerOrderView }) {
  const at = stepIndex(o)
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${i < at ? 'ecom-accent-bg' : i === at ? 'org-sand text-foreground' : 'bg-surface-secondary text-foreground-muted'}`}
          >
            {i < at ? <Check className="h-3 w-3" /> : i === at ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
          </span>
          <span className={i <= at ? 'text-foreground' : 'text-foreground-muted'}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border-default" />}
        </li>
      ))}
    </ol>
  )
}

/** Buy a domain through the platform: search, confirm, then watch it register and go live. */
export default function DomainPurchase({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState<State | null>(null)
  const [picked, setPicked] = useState<SearchResult | null>(null)
  const [contact, setContact] = useState<DomainContact>(EMPTY_CONTACT)
  const [busy, setBusy] = useState<string | null>(null)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [searchKey, setSearchKey] = useState(0)
  const sRef = useRef<State | null>(null)
  sRef.current = s

  const load = useCallback(async () => {
    const res = await fetch(`/api/ecom/domains/orders?tenantId=${tenantId}`)
    const data = await res.json().catch(() => null)
    if (res.ok && data) {
      setS(data)
      setContact(c => (c.email ? c : { ...EMPTY_CONTACT, ...data.contact }))
    }
  }, [tenantId])

  useEffect(() => {
    load()
  }, [load])

  const replace = (o: OwnerOrderView) => setS(prev => (prev ? { ...prev, orders: prev.orders.some(x => x.id === o.id) ? prev.orders.map(x => (x.id === o.id ? o : x)) : [o, ...prev.orders] } : prev))

  // While a domain registers and sets up, ask the server to move it along every few seconds.
  const inFlight = s?.orders.filter(o => POLLED.includes(o.status)).map(o => o.id).join(',') ?? ''
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(async () => {
      for (const id of inFlight.split(',')) {
        const res = await fetch(`/api/ecom/domains/orders/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) }).catch(() => null)
        const data = await res?.json().catch(() => null)
        if (data?.order) {
          const was = sRef.current?.orders.find(o => o.id === id)?.status
          replace(data.order)
          if (was !== data.order.status && ['active', 'failed'].includes(data.order.status)) load()
        }
      }
    }, 4000)
    return () => clearInterval(t)
  }, [inFlight, load])

  async function act(o: OwnerOrderView, body: Record<string, unknown>, ok?: string) {
    setBusy(o.id)
    try {
      const res = await fetch(`/api/ecom/domains/orders/${o.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (data.order) replace(data.order)
      if (!res.ok) showToast(data.error || 'Something went wrong', 'error')
      else if (ok) showToast(ok, 'success')
      if (body.action === 'buy' || body.action === 'renew') load()
    } finally {
      setBusy(null)
    }
  }

  async function buy() {
    if (!picked) return
    const problem = contactProblem(contact)
    if (problem) return showToast(problem, 'error')
    setBusy('buy')
    try {
      const res = await fetch('/api/ecom/domains/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, domain: picked.domain, expectedPriceInr: picked.priceInr, contact }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.order) replace(data.order)
      if (!res.ok) {
        if (data.code === 'price_changed' && data.priceInr) setPicked({ ...picked, priceInr: data.priceInr })
        showToast(data.error || 'Could not buy the domain', 'error')
        return
      }
      showToast(`Paid. Registering ${picked.domain}…`, 'success')
      setPicked(null)
      setSearchKey(k => k + 1)
      load()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  const walletHref = `/dashboard/wallet?tenant=${encodeURIComponent(tenantSlug)}`

  return (
    <section className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-foreground-muted">Your own domain</h2>
      <p className="mb-4 text-sm text-foreground-secondary">
        Buy a domain for your store. We register it in your name with privacy protection and move everything your plan gives you onto it, with HTTPS: the
        store, <span className="font-mono text-foreground">admin.</span>, <span className="font-mono text-foreground">invoice.</span> and the rest. Billed yearly from your wallet.
      </p>

      {!s && <SkeletonRows rows={2} cols={3} />}
      {s && !s.enabled && <p className="text-sm text-foreground-muted">Buying domains isn&apos;t available yet.</p>}

      {s && s.orders.length > 0 && (
        <ul className="mb-5 divide-y divide-border-default/60 rounded-xl border border-border-default/60">
          {s.orders.map(o => {
            const st = STATUS[o.status] ?? { label: o.status, tone: 'muted' as const }
            const r = o.renewal
            const shortRenewal = r?.status === 'due' && r.last_error === 'wallet balance too low'
            return (
              <li key={o.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all font-mono text-base text-foreground">{o.domain}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {o.status === 'active' && o.expires_at && (
                    <span className="ml-auto text-xs text-foreground-muted">
                      {o.auto_renew ? 'Renews' : 'Expires'} {fmtDate(o.expires_at)}
                      {o.auto_renew && o.renewalPriceInr ? ` · ${inr(o.renewalPriceInr)}/year` : ''}
                    </span>
                  )}
                </div>

                {POLLED.includes(o.status) && <Progress o={o} />}
                {(POLLED.includes(o.status) || o.status === 'requested') && o.events.length > 0 && (
                  <p className="mt-2 text-xs text-foreground-secondary">{o.events[o.events.length - 1].message}</p>
                )}

                {o.status === 'requested' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-foreground-secondary">{inr(o.price_inr)} for the first year.</span>
                    <button onClick={() => act(o, { action: 'buy' })} disabled={!!busy} className={primaryBtn}>
                      {busy === o.id ? 'Buying…' : `Buy now · ${inr(o.price_inr)}`}
                    </button>
                    {s.walletInr < o.price_inr && (
                      <Link href={walletHref} className={secondaryBtn}>
                        Top up {inr(o.price_inr - s.walletInr)}
                      </Link>
                    )}
                    <button onClick={() => act(o, { action: 'cancel' }, 'Cancelled')} disabled={!!busy} className={ghostBtn}>
                      Cancel
                    </button>
                  </div>
                )}

                {o.status === 'active' && (
                  <div className="mt-3 space-y-3">
                    <ul className="space-y-1">
                      {o.hosts.map(h => (
                        <li key={h.host} className="flex min-w-0 items-center gap-2">
                          <span className="w-28 shrink-0 text-xs text-foreground-muted">{HOST_LABEL[h.host === o.domain ? '' : h.host.split('.')[0]] ?? h.host.split('.')[0]}</span>
                          <a href={`https://${h.host}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all font-mono text-xs text-foreground underline-offset-2 hover:underline">
                            {h.host} <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          {!h.live && <span className="text-[10px] text-foreground-muted">issuing HTTPS…</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-foreground-muted">The admin panel needs your admin certificate, as on admin-{tenantSlug}.</p>
                    {!o.contact_verified && (
                      <div className={`${noteCls} org-peach`}>
                        Confirm the email the domain registry sent to <span className="font-medium">{o.contactEmail}</span>. Without it the domain is suspended 15 days after registration.
                      </div>
                    )}
                    {shortRenewal && (
                      <div className={`${noteCls} org-peach flex flex-wrap items-center gap-3`}>
                        <span className="min-w-0 flex-1">
                          Renewal needs {inr(r!.price_inr ?? 0)} in your wallet (you have {inr(s.walletInr)}). We retry daily until {s.renewCutoffDays} days before {fmtDate(o.expires_at!)}; after that it expires.
                        </span>
                        <Link href={walletHref} className={secondaryBtn}>
                          Top up
                        </Link>
                        <button onClick={() => act(o, { action: 'renew' }, 'Renewal submitted')} disabled={!!busy} className={primaryBtn}>
                          Renew now
                        </button>
                      </div>
                    )}
                    {r?.status === 'renewing' && <p className="text-xs text-foreground-secondary">Renewal paid and in progress at the registry.</p>}
                    {r?.status === 'lapsed' && <div className={`${noteCls} bg-[#f2d4cd] text-[#8a2e1f]`}>Not renewed. {o.domain} expires on {fmtDate(o.expires_at!)}.</div>}
                    <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                      <input type="checkbox" checked={o.auto_renew} disabled={!!busy || r?.status === 'lapsed'} onChange={e => act(o, { action: 'auto_renew', on: e.target.checked }, e.target.checked ? 'Auto-renew on' : 'Auto-renew off')} />
                      Renew every year from my wallet{o.renewalPriceInr ? ` (${inr(o.renewalPriceInr)})` : ''}, starting {s.renewLeadDays} days before it expires
                    </label>
                  </div>
                )}

                {o.status === 'failed' && (
                  <p className="mt-2 text-xs text-foreground-secondary">
                    {o.last_error}
                    {o.refunded_inr ? ` · ${inr(o.refunded_inr)} refunded to your wallet.` : ''}
                  </p>
                )}
                {o.status === 'expired' && <p className="mt-2 text-xs text-foreground-secondary">This domain expired and no longer points at your store.</p>}

                {o.events.length > 1 && (
                  <button onClick={() => setOpenLog(openLog === o.id ? null : o.id)} className="mt-2 text-xs text-foreground-muted underline-offset-2 hover:underline">
                    {openLog === o.id ? 'Hide activity' : 'Show activity'}
                  </button>
                )}
                {openLog === o.id && (
                  <ol className="mt-2 space-y-1 border-l border-border-default pl-3 text-xs text-foreground-secondary">
                    {[...o.events].reverse().map((e, i) => (
                      <li key={i} className={e.level === 'error' ? 'text-[#8a2e1f]' : ''}>
                        <span className="text-foreground-muted">{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span> · {e.message}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {s?.enabled && (
        <div className="space-y-5">
          <DomainSearch key={searchKey} onPick={setPicked} picked={picked?.domain} pickLabel="Buy" />
          {picked && (
            <div className="space-y-5 rounded-xl border border-border-default p-5">
              <div>
                <div className="font-mono text-lg text-foreground break-all">{picked.domain}</div>
                <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
                  <li>
                    <span className="font-semibold text-foreground">{inr(picked.priceInr)}</span> for the first year, charged now from your wallet (balance {inr(s.walletInr)}).
                  </li>
                  <li>Renews every year at {inr(picked.renewalPriceInr)} from your wallet; you can turn auto-renew off.</li>
                  <li>
                    Includes WHOIS privacy, DNS and HTTPS for {picked.domain} and every address your plan has on it (www., admin., invoice. and so on). If registration fails, the charge
                    is refunded.
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-foreground">Registrant contact</h3>
                <ContactFields value={contact} onChange={setContact} />
                <p className="mt-2 text-xs text-foreground-muted">The registry emails this address to confirm it. Confirm within 15 days or the domain is suspended.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {s.walletInr < picked.priceInr ? (
                  <>
                    <span className="text-sm text-foreground-secondary">Your wallet is {inr(picked.priceInr - s.walletInr)} short.</span>
                    <Link href={walletHref} className={primaryBtn}>
                      Top up wallet
                    </Link>
                  </>
                ) : (
                  <button onClick={buy} disabled={busy === 'buy'} className={primaryBtn}>
                    {busy === 'buy' ? 'Buying…' : `Buy ${picked.domain} · ${inr(picked.priceInr)}/year`}
                  </button>
                )}
                <button onClick={() => setPicked(null)} className={ghostBtn}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
