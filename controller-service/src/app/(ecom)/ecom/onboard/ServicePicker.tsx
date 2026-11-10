'use client'

import { useState } from 'react'
import { Store, MessageSquare, FileText } from 'lucide-react'
import { ChoiceCards } from '../_ui'
import PageHeader from '../dashboard/_components/PageHeader'
import { primaryBtn } from './ui'

export type ServiceChoice = 'store' | 'messaging' | 'documents'

const OPTIONS: { id: ServiceChoice; title: string; copy: string; icon: typeof Store; tag?: string }[] = [
  { id: 'store', title: 'Online store', copy: 'Your own storefront + admin on a subdomain — payments, delivery, GST, the lot.', icon: Store, tag: 'Monthly plan' },
  { id: 'messaging', title: 'Messaging API', copy: 'Send email, SMS and WhatsApp from any app with an API key. Pay per message from a wallet.', icon: MessageSquare, tag: 'Pay as you go' },
  { id: 'documents', title: 'Documents API', copy: 'Generate GST invoices, quotations, receipts and labels as PDFs over an API.', icon: FileText, tag: 'Pay as you go' },
]

export default function ServicePicker({ initial = [], onContinue }: { initial?: ServiceChoice[]; onContinue: (choice: ServiceChoice[]) => void }) {
  const [picked, setPicked] = useState<ServiceChoice[]>(initial)
  return (
    <div className="w-full">
      <PageHeader eyebrow="Get started" title="What do you need?" description="Pick one or more. You can add the others any time from your dashboard — they all share one wallet." />
      <ChoiceCards multiple ariaLabel="Services" className="gap-4" columns="grid-cols-1 md:grid-cols-3" cardClassName="rounded-2xl p-5 sm:p-6 bg-surface-elevated" value={picked} onChange={setPicked}
        options={OPTIONS.map(o => {
          const on = picked.includes(o.id)
          const Icon = o.icon
          return {
            value: o.id, label: o.title,
            content: (
              <div className="flex items-start gap-4 md:block">
                <span className={`grid shrink-0 place-items-center w-10 h-10 rounded-full ${on ? 'ecom-sel' : 'org-sage org-sage-text'}`}>
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0 pr-6 md:pr-0">
                  <h3 className="font-display font-black text-lg sm:text-xl md:mt-4">{o.title}</h3>
                  <p className="mt-1.5 text-sm text-foreground-secondary leading-relaxed">{o.copy}</p>
                  {o.tag && <span className="inline-flex items-center mt-3 px-2.5 py-0.5 rounded-full org-sand text-xs font-medium text-foreground-secondary">{o.tag}</span>}
                </div>
              </div>
            ),
          }
        })} />
      <div className="mt-6">
        <button type="button" onClick={() => onContinue(picked)} disabled={picked.length === 0} className={`${primaryBtn} w-full sm:w-auto px-6`}>
          Continue
        </button>
      </div>
    </div>
  )
}
