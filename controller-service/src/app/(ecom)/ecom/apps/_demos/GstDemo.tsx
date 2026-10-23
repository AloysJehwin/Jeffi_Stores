'use client'

import { useState } from 'react'
import { ShoppingBag, ReceiptText, Percent, FileSpreadsheet } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Table, Tag, Stat, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'order', label: 'Order', icon: ShoppingBag },
  { id: 'invoice', label: 'Tax invoice', icon: ReceiptText },
  { id: 'split', label: 'CGST / SGST / IGST', icon: Percent },
  { id: 'gstr', label: 'GSTR export', icon: FileSpreadsheet },
]

export default function GstDemo() {
  const s = useSteps(STEPS)
  const [inv, setInv] = useState(false)
  const [exp, setExp] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - gst">
      {s.step === 'order' && <Table cols={['Order', 'Buyer state', 'Taxable', 'GST', 'Total']} rows={[['#1043', 'Tamil Nadu (intra)', rs(2118), rs(381), rs(2499)], ['#1040', 'Karnataka (inter)', rs(1016), rs(183), rs(1199)]]} />}
      {s.step === 'invoice' && <Done icon={ReceiptText} title="Generate tax invoice" copy="Sequential invoice number, your GSTIN, HSN per line and the buyer's GSTIN if B2B." done={inv} onAction={() => setInv(true)} actionLabel="Generate" doneLabel="INV-2024-0177" action={<Tag tone="ok">Emailed to customer</Tag>} />}
      {s.step === 'split' && (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1"><Stat label="CGST 9%" value={rs(190.5)} /><Stat label="SGST 9%" value={rs(190.5)} /><Stat label="IGST" value={rs(0)} /></div>
          <Table cols={['Line', 'HSN', 'Taxable', 'Rate', 'Tax']} rows={[['Wireless Headphones', '85183000', rs(2118), '18%', rs(381)]]} />
          <p className="text-sm text-foreground-secondary">Intra-state order → CGST + SGST. Inter-state would switch to IGST automatically.</p>
        </div>
      )}
      {s.step === 'gstr' && <Done icon={FileSpreadsheet} title="GSTR-1 for October" copy="B2B, B2C-small and HSN summaries exported in the portal's JSON/CSV format." done={exp} onAction={() => setExp(true)} actionLabel="Export GSTR-1" doneLabel="Exported" action={<Tag tone="ok">gstr1-2024-10.json</Tag>} />}
    </AppDemoShell>
  )
}
