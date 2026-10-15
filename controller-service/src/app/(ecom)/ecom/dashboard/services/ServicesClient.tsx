'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, FileText, Loader2, MessageSquare, XCircle } from 'lucide-react'
import type { ApiService, ServiceState } from '@/lib/ecom/service-states'
import { DOCUMENT_POINTS, InvoicePreview, MESSAGING_POINTS, WhatsAppPreview, rupees } from '../../_ui/service-previews'

type Prices = { messages: Record<string, number>; documents: Record<string, number>; media: number }

const INFO: Record<ApiService, { title: string; blurb: string; icon: typeof FileText; points: string[]; href: string }> = {
  messaging: { title: 'Messaging API', blurb: 'WhatsApp, SMS and email to your customers from one API call.', icon: MessageSquare, points: MESSAGING_POINTS, href: '/dashboard/messaging' },
  documents: { title: 'Documents API', blurb: 'GST invoices and business documents as a PDF and a shareable link.', icon: FileText, points: DOCUMENT_POINTS, href: '/dashboard/documents' },
}

/** One card per API service; `compact` is the Overview's version for services not yet live. */
export default function ServicesClient({ states, prices, compact = false }: { states: Record<ApiService, ServiceState>; prices: Prices; compact?: boolean }) {
  const services = (['messaging', 'documents'] as const).filter(s => !compact || states[s].status !== 'live')
  if (!services.length) return null
  return (
    <div className={`grid gap-4 ${services.length > 1 ? 'lg:grid-cols-2' : ''}`}>
      {services.map(s => <ServiceCard key={s} service={s} state={states[s]} prices={prices} compact={compact} />)}
    </div>
  )
}

function ServiceCard({ service, state, prices, compact }: { service: ApiService; state: ServiceState; prices: Prices; compact: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = INFO[service]
  const Icon = info.icon
  const priceRows: [string, number][] = service === 'messaging'
    ? [['WhatsApp', prices.messages.whatsapp], ['SMS', prices.messages.sms], ['Email', prices.messages.email], ['Image hosting', prices.media]]
    : [['Invoice', prices.documents.invoice], ['Quotation', prices.documents.quotation], ['Receipt', prices.documents.receipt], ['Packing slip', prices.documents.packing_slip], ['Label', prices.documents.label], ['Purchase order', prices.documents.purchase_order]]

  async function add() {
    setBusy(true); setError(null)
    const r = await fetch('/api/ecom/services/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ services: [service] }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.message || d.error || 'Could not add the service'); setBusy(false); return }
    router.refresh()
  }

  return (
    <section className="flex flex-col rounded-2xl border border-border-default bg-surface-elevated p-6">
      <div className="flex items-start justify-between gap-3">
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
      {error && <p className="mt-4 text-sm text-[#8a2e1f]">{error}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
        {state.status === 'live' && <Link href={info.href} className="rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">Open {service === 'messaging' ? 'Messaging' : 'Documents'}</Link>}
        {(state.status === 'off' || state.status === 'rejected') && (
          <button type="button" onClick={add} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {state.status === 'rejected' ? 'Request again' : `Add ${service === 'messaging' ? 'Messaging' : 'Documents'}`}
          </button>
        )}
        {state.status === 'pending' && <span className="text-sm text-foreground-secondary">Jeffi is reviewing it. You can create API keys meanwhile.</span>}
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
