'use client'

import { useState } from 'react'
import { FileSignature, Send, ThumbsUp, ShoppingBag } from 'lucide-react'
import { AppDemoShell, useSteps, Panel, Table, Tag, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'build', label: 'Build quote', icon: FileSignature },
  { id: 'send', label: 'Send', icon: Send },
  { id: 'accept', label: 'Buyer accepts', icon: ThumbsUp },
  { id: 'convert', label: 'Convert to order', icon: ShoppingBag },
]

export default function QuotationsDemo() {
  const s = useSteps(STEPS)
  const [sent, setSent] = useState(false)
  const [converted, setConverted] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - quotations">
      {s.step === 'build' && (
        <Panel title="QT-0017 · Meridian Cafés" action={<Tag tone="neutral">Draft</Tag>}>
          <Table cols={['Item', 'Qty', 'Unit', 'GST', 'Total']} rows={[['Clay mug set', 40, rs(760), '12%', rs(34048)], ['Stoneware plate', 60, rs(190), '12%', rs(12768)], [<b key="t">Grand total</b>, '', '', '', <b key="v">{rs(46816)}</b>]]} />
        </Panel>
      )}
      {s.step === 'send' && (
        <Done icon={Send} title="Send to buyer" copy="A PDF quote with your GST details goes out by email, valid for 14 days." done={sent} onAction={() => setSent(true)} actionLabel="Send quote" doneLabel="Sent" action={<Tag tone="ok">Opened by buyer · 2 min ago</Tag>} />
      )}
      {s.step === 'accept' && (
        <div className="h-full grid place-items-center text-center">
          <div className="max-w-sm rounded-[2rem] org-sage p-6 sm:p-8">
            <p className="text-xs uppercase tracking-widest org-sage-text">Buyer response</p>
            <p className="font-display font-black text-2xl mt-2">Accepted</p>
            <p className="text-sm text-foreground-secondary mt-2">Meridian Cafés accepted QT-0017 for {rs(46816)}.</p>
          </div>
        </div>
      )}
      {s.step === 'convert' && (
        <Done icon={ShoppingBag} title="Convert to order" copy="One click turns the accepted quote into order #1044 with all lines and pricing carried over." done={converted} onAction={() => setConverted(true)} actionLabel="Convert" doneLabel="Order #1044 created" action={<Tag tone="ok">Invoice ready</Tag>} />
      )}
    </AppDemoShell>
  )
}
