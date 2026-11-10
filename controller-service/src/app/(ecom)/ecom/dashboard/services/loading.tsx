import { Check, FileText, MessageSquare } from 'lucide-react'
import { DOCUMENT_POINTS, MESSAGING_POINTS } from '../../_ui/service-previews'
import { ConsoleLoading, PillLoading, Sk } from '../_components/Skeleton'

const CARDS = [
  { title: 'Messaging API', blurb: 'WhatsApp, SMS and email to your customers from one API call.', icon: MessageSquare, points: MESSAGING_POINTS, prices: 4 },
  { title: 'Documents API', blurb: 'GST invoices and business documents as a PDF and a shareable link.', icon: FileText, points: DOCUMENT_POINTS, prices: 6 },
]

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Developers" title="Services" description="Messaging and Documents are pay-per-use APIs, billed from your wallet. Add one here; it goes live once Jeffi approves it.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARDS.map(c => (
          <section key={c.title} className="flex flex-col rounded-2xl border border-border-default bg-surface-elevated p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full org-sand"><c.icon className="h-5 w-5 text-foreground" /></span>
                <div>
                  <h2 className="font-display text-lg font-black text-foreground">{c.title}</h2>
                  <p className="text-sm text-foreground-secondary">{c.blurb}</p>
                </div>
              </div>
              <PillLoading className="w-24" />
            </div>
            <ul className="mt-5 space-y-2 text-sm text-foreground-secondary">
              {c.points.map(t => <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />{t}</li>)}
            </ul>
            <Sk className="mt-5 h-48 w-full rounded-2xl" />
            <div className="mt-5 flex flex-wrap gap-2">
              {Array.from({ length: c.prices }).map((_, i) => <Sk key={i} className="h-6 w-24 rounded-full" />)}
            </div>
          </section>
        ))}
      </div>
    </ConsoleLoading>
  )
}
