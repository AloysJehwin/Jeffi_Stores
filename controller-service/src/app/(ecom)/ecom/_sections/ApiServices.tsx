import { Check } from 'lucide-react'
import { priceList } from '@jeffi/pricing'
import { Eyebrow, Display, Pill, SandCard } from '../_ui'
import { DOCUMENT_POINTS, InvoicePreview, MESSAGING_POINTS, WhatsAppPreview, rupees } from '../_ui/service-previews'

// Messaging and Documents as standalone APIs: usable with or without a store.
export default function ApiServices() {
  const p = priceList()
  const docFrom = Math.min(...Object.values(p.documents))
  return (
    <section id="apis" className="mx-auto max-w-7xl px-6 py-24">
      <Eyebrow>Not just stores</Eyebrow>
      <Display className="mt-3 max-w-3xl text-4xl lg:text-5xl">Messaging and documents, as an API</Display>
      <p className="mt-4 max-w-2xl text-foreground-secondary">
        The same engine that runs our stores, on its own. Send WhatsApp, SMS and email, and render GST-ready invoices and documents from your own app. Pay per use from a prepaid wallet, no plan needed.
      </p>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <SandCard className="flex flex-col">
          <div className="text-xs font-bold uppercase tracking-[0.18em] org-brown">Messaging API</div>
          <h3 className="mt-2 font-display text-2xl font-black text-foreground">Reach customers where they read</h3>
          <Points items={MESSAGING_POINTS} />
          <WhatsAppPreview className="mt-6" />
          <Prices items={[['WhatsApp', p.messages.whatsapp], ['SMS', p.messages.sms], ['Email', p.messages.email], ['Image hosting', p.media]]} unit="per send" />
        </SandCard>
        <SandCard className="flex flex-col">
          <div className="text-xs font-bold uppercase tracking-[0.18em] org-brown">Documents API</div>
          <h3 className="mt-2 font-display text-2xl font-black text-foreground">Invoices that add up, every time</h3>
          <Points items={DOCUMENT_POINTS} />
          <InvoicePreview className="mt-6" />
          <Prices items={[['Invoice', p.documents.invoice], ['Quotation', p.documents.quotation], ['Receipt', p.documents.receipt], ['Label', p.documents.label]]} unit="per document" />
        </SandCard>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Pill href="/signup" className="px-8 py-4 text-base">Get an API key</Pill>
        <span className="text-sm text-foreground-secondary">Documents from {rupees(docFrom)}. Live in minutes, no store required.</span>
      </div>
    </section>
  )
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm text-foreground-secondary">
      {items.map(t => <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 org-brown" />{t}</li>)}
    </ul>
  )
}

function Prices({ items, unit }: { items: [string, number][]; unit: string }) {
  return (
    <div className="mt-auto pt-6">
      <div className="flex flex-wrap gap-2">
        {items.map(([label, n]) => (
          <span key={label} className="rounded-full bg-surface-elevated px-3 py-1 text-xs text-foreground"><b className="tabular-nums">{rupees(n)}</b> {label}</span>
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground-muted">Prices {unit}, charged from your wallet as you use them.</p>
    </div>
  )
}
