'use client'

import { useState } from 'react'
import { Inbox, MessagesSquare, Handshake, ShoppingBag } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Tag, Table, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'receive', label: 'RFQ received', icon: Inbox },
  { id: 'negotiate', label: 'Negotiate', icon: MessagesSquare },
  { id: 'offer', label: 'Final offer', icon: Handshake },
  { id: 'convert', label: 'Convert', icon: ShoppingBag },
]

export default function RfqsDemo() {
  const s = useSteps(STEPS)
  const [done, setDone] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - rfqs">
      {s.step === 'receive' && <Table cols={['RFQ', 'Buyer', 'Item', 'Qty', 'Target']} rows={[['RFQ-012', 'Blue Door Studio', 'Brass lamp', 80, rs(2600)]]} />}
      {s.step === 'negotiate' && <div className="h-full max-w-md space-y-2 text-sm">{[['Buyer', '80 units at ₹2,600?'], ['You', 'Can do ₹2,750 with free shipping.'], ['Buyer', '₹2,700 and we sign today.']].map(([w, m], i) => <div key={i} className={`rounded-2xl px-4 py-3 ${w === 'You' ? 'org-peach ml-10' : 'org-sand mr-10'}`}><p className="text-[11px] text-foreground-muted">{w}</p>{m}</div>)}</div>}
      {s.step === 'offer' && <Done icon={Handshake} title="Offer ₹2,700 × 80" copy="Sends a binding offer; the buyer accepts in one click from their portal." done={done} onAction={() => setDone(true)} actionLabel="Send final offer" doneLabel="Accepted" action={<Tag tone="ok">{rs(216000)} · Net 30</Tag>} />}
      {s.step === 'convert' && <Table cols={['Order', 'Buyer', 'Total', 'Status']} rows={[['#1061', 'Blue Door Studio', rs(216000), <Tag key="t" tone="ok">Converted from RFQ-012</Tag>]]} />}
    </AppDemoShell>
  )
}
