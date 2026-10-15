'use client'

import { useState } from 'react'
import { Truck, PackageSearch, MapPin, Home } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Tag, Table, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'create', label: 'Create shipment', icon: Truck },
  { id: 'pickup', label: 'Pickup', icon: PackageSearch },
  { id: 'transit', label: 'In transit', icon: MapPin },
  { id: 'delivered', label: 'Delivered', icon: Home },
]
const EVENTS = [['Shipment created', 'Chennai · Nova Shop', 'Mon 10:12'], ['Picked up', 'Chennai · Delhivery', 'Mon 15:40'], ['In transit', 'Bengaluru hub', 'Tue 06:20'], ['Out for delivery', 'Bengaluru · HSR', 'Wed 08:05'], ['Delivered', 'Signed by A. Morgan', 'Wed 13:47']]

export default function DeliveryDemo() {
  const s = useSteps(STEPS)
  const [created, setCreated] = useState(false)
  const shown = { create: 1, pickup: 2, transit: 4, delivered: 5 }[s.step] ?? 1
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - delivery">
      {s.step === 'create' ? (
        <Done icon={Truck} title="Order #1043 · ready to ship" copy="One click books a Delhivery pickup and generates the AWB and label." done={created} onAction={() => setCreated(true)} actionLabel="Create shipment" doneLabel="AWB 1349 2211 0087" action={<Tag tone="ok">Label ready</Tag>} />
      ) : (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-5 gap-2">
            {EVENTS.map(([e], i) => <div key={e} className={`h-2 rounded-full ${i < shown ? 'ecom-accent-bg' : 'org-sand'}`} />)}
          </div>
          <Table cols={['Event', 'Where', 'When']} rows={EVENTS.slice(0, shown).reverse()} />
          {s.step === 'delivered' && <Tag tone="ok">Customer notified · COD remitted in 3 days</Tag>}
        </div>
      )}
    </AppDemoShell>
  )
}
