'use client'

import { useState } from 'react'
import { ShoppingBag, FileText, Printer } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Table, Tag, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'order', label: 'Pick an order', icon: ShoppingBag },
  { id: 'generate', label: 'Generate slip', icon: FileText },
  { id: 'print', label: 'Print', icon: Printer },
]

export default function PackingSlipsDemo() {
  const s = useSteps(STEPS)
  const [gen, setGen] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - packing slips">
      {s.step === 'order' && <Table cols={['Order', 'Customer', 'Items', 'Status']} rows={[['#1043', 'Alex Morgan', 1, <Tag key="t" tone="warn">Packing</Tag>], ['#1042', 'Priya S.', 2, <Tag key="t" tone="ok">Shipped</Tag>]]} />}
      {s.step === 'generate' && <Done icon={FileText} title="GST packing slip" copy="Line items, HSN codes, tax split and your seal — generated from the order." done={gen} onAction={() => setGen(true)} actionLabel="Generate" doneLabel="Slip ready" action={<Tag tone="ok">PS-1043.pdf</Tag>} />}
      {s.step === 'print' && (
        <div className="h-full grid place-items-center">
          <div className="w-80 rounded-2xl bg-surface-elevated p-5 text-xs space-y-2">
            <p className="font-display font-black text-base">Packing slip · #1043</p>
            <p className="text-foreground-muted">Nova Shop · GSTIN 33AABCN0001A1Z9</p>
            <hr className="border-border-default" />
            <p className="flex justify-between"><span>Wireless Headphones · 85183000</span><span>{rs(2499)}</span></p>
            <p className="flex justify-between text-foreground-muted"><span>CGST 9% + SGST 9%</span><span>{rs(381)}</span></p>
            <hr className="border-border-default" />
            <p>Deliver to: Alex Morgan, 14 Marina Ave, Chennai 600001</p>
          </div>
        </div>
      )}
    </AppDemoShell>
  )
}
