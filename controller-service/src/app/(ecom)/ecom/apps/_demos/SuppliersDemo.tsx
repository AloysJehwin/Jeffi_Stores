'use client'

import { useState } from 'react'
import { Truck, ClipboardList, PackageCheck, Boxes } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Panel, Table, Tag, Stat, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'add', label: 'Add supplier', icon: Truck },
  { id: 'po', label: 'Purchase order', icon: ClipboardList },
  { id: 'grn', label: 'Receive goods', icon: PackageCheck },
  { id: 'stock', label: 'Stock updated', icon: Boxes },
]

export default function SuppliersDemo() {
  const s = useSteps(STEPS)
  const [received, setReceived] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - suppliers">
      {s.step === 'add' && (
        <div className="h-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
          <div className="sm:col-span-2"><Field label="Supplier" value="Kiln & Co. Ceramics" /></div>
          <Field label="GSTIN" value="33AABCK1234F1Z5" />
          <Field label="Payment terms" value="Net 30" />
          <Field label="Contact" value="orders@kilnco.in" />
          <Field label="Lead time" value="7 days" />
        </div>
      )}
      {s.step === 'po' && (
        <Panel title="PO-0031 · Kiln & Co." action={<Tag tone="warn">Sent</Tag>}>
          <Table cols={['Item', 'Qty', 'Unit cost', 'Total']} rows={[['Clay mug set', 24, rs(310), rs(7440)], ['Stoneware plate', 12, rs(220), rs(2640)]]} />
        </Panel>
      )}
      {s.step === 'grn' && (
        <Done icon={PackageCheck} title="Goods arrived" copy="Count what came in against PO-0031. Short deliveries stay open on the PO." done={received} onAction={() => setReceived(true)} actionLabel="Post receipt" doneLabel="GRN-0022 posted" action={<Tag tone="ok">36 units received</Tag>} />
      )}
      {s.step === 'stock' && (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3"><Stat label="Clay mug set" value={received ? 27 : 3} tone="accent" /><Stat label="Stoneware plate" value={received ? 12 : 0} /></div>
          <Table cols={['When', 'Movement', 'Ref']} rows={[['Just now', '+24 Clay mug set', 'GRN-0022'], ['Just now', '+12 Stoneware plate', 'GRN-0022'], ['3 days ago', '−5 Clay mug set', 'Order #1042']]} />
        </div>
      )}
    </AppDemoShell>
  )
}
