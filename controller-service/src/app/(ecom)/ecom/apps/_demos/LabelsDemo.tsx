'use client'

import { useState } from 'react'
import { ShoppingBag, Tag as TagIcon, Printer, ScanLine } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Table, Tag, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'order', label: 'Order', icon: ShoppingBag },
  { id: 'label', label: 'Generate label', icon: TagIcon },
  { id: 'print', label: 'Print', icon: Printer },
  { id: 'scan', label: 'Courier scans', icon: ScanLine },
]

export default function LabelsDemo() {
  const s = useSteps(STEPS)
  const [gen, setGen] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - labels">
      {s.step === 'order' && <Table cols={['Order', 'AWB', 'Courier', 'Label']} rows={[['#1043', '1349 2211 0087', 'Delhivery', <Tag key="t" tone="warn">Not printed</Tag>]]} />}
      {s.step === 'label' && <Done icon={TagIcon} title="Shipping label" copy="4×6 thermal label with AWB barcode, sorting code and return address." done={gen} onAction={() => setGen(true)} actionLabel="Generate label" doneLabel="Label ready" action={<Tag tone="ok">LB-1043.pdf</Tag>} />}
      {(s.step === 'print' || s.step === 'scan') && (
        <div className="h-full grid place-items-center">
          <div className="w-full max-w-72 sm:w-72 rounded-2xl bg-surface-elevated p-5 space-y-3">
            <p className="font-display font-black">Delhivery · Surface</p>
            <div className="h-14 bg-[repeating-linear-gradient(90deg,#1b1714_0_2px,transparent_2px_5px)] rounded" />
            <p className="font-mono text-sm">1349 2211 0087</p>
            <p className="text-xs text-foreground-secondary">To: Alex Morgan · Chennai 600001<br />From: Nova Shop · Chennai 600017</p>
            {s.step === 'scan' && <Tag tone="ok">Scanned at pickup · 15:40</Tag>}
          </div>
        </div>
      )}
    </AppDemoShell>
  )
}
