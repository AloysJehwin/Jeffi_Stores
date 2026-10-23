'use client'

import { useState } from 'react'
import { ShoppingBag, CheckCircle2, Package, Truck, Home } from 'lucide-react'
import { AppDemoShell, useSteps, Panel, Btn, Table, Tag, Stat, Done, Progress, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'lands', label: 'Order lands', icon: ShoppingBag },
  { id: 'confirm', label: 'Confirm', icon: CheckCircle2 },
  { id: 'pack', label: 'Pack', icon: Package },
  { id: 'ship', label: 'Ship', icon: Truck },
  { id: 'delivered', label: 'Delivered', icon: Home },
]

export default function OrdersDemo() {
  const s = useSteps(STEPS)
  const [confirmed, setConfirmed] = useState(false)
  const [packed, setPacked] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - orders">
      {s.step === 'lands' && (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1"><Stat label="New today" value={7} tone="accent" /><Stat label="Pending" value={3} /><Stat label="Revenue" value={rs(18240)} /></div>
          <Table cols={['Order', 'Customer', 'Total', 'Method', 'Status']} rows={[['#1043', 'Alex Morgan', rs(2499), 'UPI', <Tag key="t" tone="warn">New</Tag>], ['#1042', 'Priya S.', rs(1198), 'COD', <Tag key="t" tone="neutral">Processing</Tag>], ['#1041', 'Rahul K.', rs(3199), 'Card', <Tag key="t" tone="ok">Shipped</Tag>]]} />
        </div>
      )}
      {s.step === 'confirm' && (
        <Done icon={CheckCircle2} title="Order #1043 · Alex Morgan" copy="Wireless Headphones × 1 · paid via UPI · ships to Chennai 600001." done={confirmed} onAction={() => setConfirmed(true)} actionLabel="Confirm order" doneLabel="Confirmed" action={<Tag tone="ok">Customer notified by email + WhatsApp</Tag>} />
      )}
      {s.step === 'pack' && (
        <Panel title="Pick & pack" action={<Btn onClick={() => setPacked(true)} disabled={packed}>{packed ? 'Packed' : 'Mark packed'}</Btn>}>
          <div className="space-y-4 max-w-lg">
            <Table cols={['Item', 'SKU', 'Qty', 'Bin']} rows={[['Wireless Headphones · Black', 'NS-HD-01-BLK', 1, 'A-12']]} />
            <Progress value={packed ? 100 : 40} />
            <p className="text-sm text-foreground-secondary">{packed ? 'Packing slip and label are ready to print.' : 'Scan the SKU to tick it off.'}</p>
          </div>
        </Panel>
      )}
      {s.step === 'ship' && (
        <div className="h-full flex flex-col gap-4 max-w-lg">
          <div className="rounded-2xl org-sand p-5"><p className="text-xs uppercase tracking-widest text-foreground-muted">Delhivery AWB</p><p className="font-display font-black text-2xl mt-1">1349 2211 0087</p></div>
          <Table cols={['Event', 'When']} rows={[['Shipment created', 'Today 10:12'], ['Picked up', 'Today 15:40'], ['In transit · Chennai hub', 'Today 21:05']]} />
        </div>
      )}
      {s.step === 'delivered' && (
        <Done icon={Home} title="Delivered" copy="Signed for at 14 Marina Ave. The order is closed and settlement is queued." done onAction={() => {}} actionLabel="" doneLabel="Delivered · 2 days" action={<Tag tone="ok">Review request sent</Tag>} />
      )}
    </AppDemoShell>
  )
}
