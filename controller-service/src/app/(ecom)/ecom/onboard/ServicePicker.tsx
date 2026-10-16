'use client'

import { useState } from 'react'
import { Store, MessageSquare, FileText } from 'lucide-react'
import { Eyebrow, Display, Pill, ChoiceCards } from '../_ui'

export type ServiceChoice = 'store' | 'messaging' | 'documents'

const OPTIONS: { id: ServiceChoice; title: string; copy: string; icon: typeof Store; tag?: string }[] = [
  { id: 'store', title: 'Online store', copy: 'Your own storefront + admin on a subdomain — payments, delivery, GST, the lot.', icon: Store, tag: 'Monthly plan' },
  { id: 'messaging', title: 'Messaging API', copy: 'Send email, SMS and WhatsApp from any app with an API key. Pay per message from a wallet.', icon: MessageSquare, tag: 'Pay as you go' },
  { id: 'documents', title: 'Documents API', copy: 'Generate GST invoices, quotations, receipts and labels as PDFs over an API.', icon: FileText, tag: 'Pay as you go' },
]

export default function ServicePicker({ initial = [], onContinue }: { initial?: ServiceChoice[]; onContinue: (choice: ServiceChoice[]) => void }) {
  const [picked, setPicked] = useState<ServiceChoice[]>(initial)
  return (
    <div className="max-w-5xl">
      <Eyebrow>Get started</Eyebrow>
      <Display as="h1" className="mt-3 text-4xl lg:text-5xl">What do you need?</Display>
      <p className="mt-4 text-lg text-foreground-secondary max-w-2xl">Pick one or more. You can add the others any time from your dashboard — they all share one wallet.</p>
      <ChoiceCards multiple ariaLabel="Services" className="mt-10 gap-5" columns="grid-cols-1 md:grid-cols-3" cardClassName="rounded-[2rem] p-7 bg-surface-elevated" value={picked} onChange={setPicked}
        options={OPTIONS.map(o => {
          const on = picked.includes(o.id)
          const Icon = o.icon
          return {
            value: o.id, label: o.title,
            content: (
              <>
                <span className={`grid place-items-center w-12 h-12 rounded-full ${on ? 'ecom-sel' : 'org-sage org-sage-text'}`}>
                  <Icon className="w-5 h-5" />
                </span>
                <h3 className="font-display font-black text-2xl mt-5">{o.title}</h3>
                <p className="mt-2 text-base text-foreground-secondary leading-relaxed">{o.copy}</p>
                {o.tag && <span className="inline-block mt-4 rounded-full org-sand px-3 py-1 text-xs font-semibold text-foreground-secondary">{o.tag}</span>}
              </>
            ),
          }
        })} />
      <div className="mt-10">
        <Pill onClick={() => onContinue(picked)} disabled={picked.length === 0} className="px-8 py-4 text-base disabled:opacity-40">
          Continue
        </Pill>
      </div>
    </div>
  )
}
