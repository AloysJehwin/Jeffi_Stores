'use client'

import { useState } from 'react'
import { Boxes, AlertTriangle, SlidersHorizontal, Barcode, ClipboardList } from 'lucide-react'
import { AppDemoShell, useSteps, Panel, Btn, Table, Tag, Stat, Done, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'stock', label: 'Stock levels', icon: Boxes },
  { id: 'alert', label: 'Low-stock alert', icon: AlertTriangle },
  { id: 'adjust', label: 'Adjust stock', icon: SlidersHorizontal },
  { id: 'serials', label: 'Batches & serials', icon: Barcode },
  { id: 'reorder', label: 'Reorder', icon: ClipboardList },
]
const ROWS = [
  ['Wireless Headphones', 'NS-HD-01', 42, 10],
  ['Clay mug set', 'NS-MG-04', 3, 8],
  ['Brass lamp', 'NS-LP-02', 17, 5],
  ['Linen throw', 'NS-TH-09', 0, 6],
] as const

export default function InventoryDemo() {
  const s = useSteps(STEPS)
  const [mug, setMug] = useState(3)
  const [po, setPo] = useState(false)
  const tone = (q: number, min: number) => (q === 0 ? 'bad' : q <= min ? 'warn' : 'ok')
  const label = (q: number, min: number) => (q === 0 ? 'Out of stock' : q <= min ? 'Low' : 'In stock')
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - inventory">
      {s.step === 'stock' && (
        <Panel title="Stock on hand">
          <Table cols={['Product', 'SKU', 'On hand', 'Min', 'Status']} rows={ROWS.map(([n, sku, q, m]) => [n, sku, q, m, <Tag key="t" tone={tone(q, m)}>{label(q, m)}</Tag>])} />
        </Panel>
      )}
      {s.step === 'alert' && (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3"><Stat label="Low stock" value={1} tone="accent" /><Stat label="Out of stock" value={1} /><Stat label="SKUs tracked" value={ROWS.length} /></div>
          <div className="rounded-2xl org-peach p-5">
            <p className="font-display font-black text-lg text-foreground">Clay mug set is running low</p>
            <p className="text-sm text-foreground-secondary mt-1">3 left, minimum is 8. Alert sent to WhatsApp and email.</p>
          </div>
        </div>
      )}
      {s.step === 'adjust' && (
        <Panel title="Adjust — Clay mug set">
          <div className="max-w-md space-y-4">
            <div className="flex items-center gap-4"><Btn tone="sand" onClick={() => setMug(m => Math.max(0, m - 1))}>−</Btn><span className="font-display font-black text-4xl tabular-nums w-16 text-center">{mug}</span><Btn tone="sand" onClick={() => setMug(m => m + 1)}>+</Btn></div>
            <Table cols={['When', 'Change', 'Reason']} rows={[['Just now', `${mug - 3 >= 0 ? '+' : ''}${mug - 3}`, 'Manual count'], ['2 days ago', '−5', 'Order #1042'], ['6 days ago', '+12', 'GRN-0021']]} />
          </div>
        </Panel>
      )}
      {s.step === 'serials' && (
        <Panel title="Wireless Headphones · batch B-2406">
          <Table cols={['Serial', 'Batch', 'Expiry', 'Status']} rows={['SN-77012', 'SN-77013', 'SN-77014', 'SN-77015'].map((sn, i) => [sn, 'B-2406', '—', <Tag key="t" tone={i === 1 ? 'warn' : 'ok'}>{i === 1 ? 'Sold' : 'Available'}</Tag>])} />
        </Panel>
      )}
      {s.step === 'reorder' && (
        <Done icon={ClipboardList} title="Reorder from supplier" copy="Raise a purchase order for 24 × Clay mug set to Kiln & Co." done={po} onAction={() => setPo(true)} actionLabel="Raise PO" doneLabel="PO-0031 raised" action={<Tag tone="ok">Sent to supplier</Tag>} />
      )}
    </AppDemoShell>
  )
}
