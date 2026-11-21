'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, FileText, Loader2, MessageSquare, XCircle } from 'lucide-react'
import type { ApiService, ServiceState } from '@controller/lib/ecom/service-states'
import type { KybItem } from '@controller/lib/kyb/requirements'
import { DOCUMENT_POINTS, InvoicePreview, MESSAGING_POINTS, WhatsAppPreview, rupees } from '../../_ui/service-previews'
import { kybCall } from '../business/api'
import { TodoList, todoRows, type KybGate, type TodoRow } from '../business/KybChecklist'

type Prices = { messages: Record<string, number>; documents: Record<string, number>; media: number }

const INFO: Record<ApiService, { title: string; blurb: string; icon: typeof FileText; points: string[]; href: string }> = {
  messaging: { title: 'Messaging API', blurb: 'WhatsApp, SMS and email to your customers from one API call.', icon: MessageSquare, points: MESSAGING_POINTS, href: '/dashboard/messaging' },
  documents: { title: 'Documents API', blurb: 'GST invoices and business documents as a PDF and a shareable link.', icon: FileText, points: DOCUMENT_POINTS, href: '/dashboard/documents' },
}

/**
 * One card per API service; `compact` is the Overview's version for services not yet live. A service is requested only
 * once its business verification (KYB) is complete; without `kyb` (the Overview) the cards load it themselves.
 */
export default function ServicesClient({ states, prices, compact = false, kyb: given }: { states: Record<ApiService, ServiceState>; prices: Prices; compact?: boolean; kyb?: KybGate | null }) {
  const services = (['messaging', 'documents'] as const).filter(s => !compact || states[s].status !== 'live')
  // undefined while loading; null when it couldn't be loaded (the request itself then says what is missing).
  const [fetched, setFetched] = useState<KybGate | null | undefined>(undefined)
  const load = given === undefined && services.some(s => states[s].status !== 'live')
  useEffect(() => {
    if (!load) return
    let live = true
    kybCall('/api/ecom/kyb').then(r => {
      if (live) setFetched(r.ok ? r.kyb : null)
    })
    return () => {
      live = false
    }
  }, [load])
  if (!services.length) return null
  const kyb = given !== undefined ? given : fetched
  return (
    <div className={`grid grid-cols-1 gap-4 ${services.length > 1 ? 'lg:grid-cols-2' : ''}`}>
      {services.map(s => <ServiceCard key={s} service={s} state={states[s]} prices={prices} compact={compact} kyb={kyb} />)}
    </div>
  )
}

function ServiceCard({ service, state, prices, compact, kyb }: { service: ApiService; state: ServiceState; prices: Prices; compact: boolean; kyb: KybGate | null | undefined }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the request answered was missing, when the KYB shown here was out of date.
  const [missing, setMissing] = useState<TodoRow[] | null>(null)
  const info = INFO[service]
  const Icon = info.icon
  const short = service === 'messaging' ? 'Messaging' : 'Documents'
  const priceRows: [string, number][] = service === 'messaging'
    ? [['WhatsApp', prices.messages.whatsapp], ['SMS', prices.messages.sms], ['Email', prices.messages.email], ['Image hosting', prices.media]]
    : [['Invoice', prices.documents.invoice], ['Quotation', prices.documents.quotation], ['Receipt', prices.documents.receipt], ['Packing slip', prices.documents.packing_slip], ['Label', prices.documents.label], ['Purchase order', prices.documents.purchase_order]]

  const requestable = state.status === 'off' || state.status === 'rejected'
  const gate = kyb?.services[service]
  const rows = missing ?? (kyb && gate && !gate.ready ? todoRows(gate.todo, kyb.items) : [])
  const blocked = rows.length > 0 && (requestable || state.status === 'pending')
  const loadingKyb = kyb === undefined && requestable

  async function add() {
    setBusy(true); setError(null)
    const r = await fetch('/api/ecom/services/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services: [service] }) })
    const d = await r.json().catch(() => ({}))
    if (r.status === 409 && d.code === 'kyb_required') {
      const miss: { item: KybItem; label: string; problem?: string }[] = d.missing?.[service] ?? []
      if (miss.length) setMissing(miss.map(m => ({ item: m.item, label: m.label, problem: m.problem })))
      else setError(d.error || 'Verify your business first.')
      setBusy(false)
      return
    }
    if (!r.ok) { setError(d.message || d.error || 'Could not add the service'); setBusy(false); return }
    router.refresh()
  }

  return (
    <section className="flex flex-col rounded-2xl border border-border-default bg-surface-elevated p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full org-sand"><Icon className="h-5 w-5 text-foreground" /></span>
          <div>
            <h2 className="font-display text-lg font-black text-foreground">{info.title}</h2>
            <p className="text-sm text-foreground-secondary">{info.blurb}</p>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      {!compact && (
        <>
          <ul className="mt-5 space-y-2 text-sm text-foreground-secondary">
            {info.points.map(t => <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />{t}</li>)}
          </ul>
          <div className="mt-5 rounded-2xl org-sand p-4">{service === 'messaging' ? <WhatsAppPreview /> : <InvoicePreview />}</div>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {priceRows.map(([label, n]) => (
          <span key={label} className="rounded-full border border-border-default px-3 py-1 text-xs text-foreground"><b className="tabular-nums">{rupees(n)}</b> {label}</span>
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground-muted">{service === 'messaging' ? 'Per send' : 'Per document'}, charged from your wallet.</p>

      {state.status === 'rejected' && state.note && <p className="mt-4 rounded-xl org-peach px-4 py-3 text-sm text-foreground">{state.note}</p>}

      {blocked && (
        <div className="mt-4 rounded-2xl org-peach px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{state.status === 'pending' ? 'Jeffi can approve it once your business is verified' : 'Verify your business first'}</p>
          {compact ? (
            <p className="mt-0.5 text-sm text-foreground-secondary">
              {rows.length === 1 ? 'One thing' : `${rows.length} things`} to do before {state.status === 'pending' ? 'approval' : `you can add ${short}`}.
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-foreground-secondary">{short} needs these before Jeffi can switch it on:</p>
              <TodoList rows={rows} service={service} className="mt-2" />
            </>
          )}
        </div>
      )}
      {error && <p className="mt-4 text-sm text-[#8a2e1f]">{error}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
        {state.status === 'live' && <Link href={info.href} className="rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">Open {short}</Link>}
        {blocked && <Link href={`/dashboard/business?for=${service}`} className="rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">Verify your business</Link>}
        {requestable && (
          <button
            type="button"
            onClick={add}
            disabled={busy || blocked || loadingKyb}
            title={blocked ? `Verify your business before you add ${short}` : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50 ${blocked ? 'org-sand text-foreground' : 'ecom-accent-bg text-white'}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {state.status === 'rejected' ? 'Request again' : `Add ${short}`}
          </button>
        )}
        {state.status === 'pending' && !blocked && <span className="text-sm text-foreground-secondary">Jeffi is reviewing it. You can create API keys meanwhile.</span>}
        {compact && <Link href="/dashboard/services" className="text-sm font-semibold ecom-accent-text hover:underline">Learn more</Link>}
        {state.status !== 'off' && <Link href="/dashboard/api-keys" className="text-sm font-semibold text-foreground-secondary hover:text-foreground">API keys</Link>}
      </div>
    </section>
  )
}

function StatusBadge({ state }: { state: ServiceState }) {
  const map = {
    live: { label: 'Live', cls: 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]', Icon: Check },
    pending: { label: 'Awaiting approval', cls: 'org-peach text-foreground', Icon: Clock },
    rejected: { label: 'Not approved', cls: 'org-peach text-[#8a2e1f]', Icon: XCircle },
    off: { label: 'Not added', cls: 'org-sand text-foreground-secondary', Icon: null },
  }[state.status]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${map.cls}`}>
      {map.Icon && <map.Icon className="h-3.5 w-3.5" />}{map.label}
    </span>
  )
}
