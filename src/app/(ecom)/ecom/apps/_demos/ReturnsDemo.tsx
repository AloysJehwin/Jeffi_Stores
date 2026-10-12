'use client'

import { useState } from 'react'
import { Undo2, ThumbsUp, PackageCheck, Wallet } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Tag, Field, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'request', label: 'Return request', icon: Undo2 },
  { id: 'approve', label: 'Approve', icon: ThumbsUp },
  { id: 'receive', label: 'Receive', icon: PackageCheck },
  { id: 'refund', label: 'Refund', icon: Wallet },
]

export default function ReturnsDemo() {
  const s = useSteps(STEPS)
  const [st, setSt] = useState(0)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - returns">
      {s.step === 'request' && (
        <div className="h-full max-w-md space-y-3">
          <Field label="Order" value="#1041 · Rahul K." /><Field label="Item" value="Wireless Headphones · Black" /><Field label="Reason" value="Wrong colour" /><Field label="Status" value={<Tag tone="warn">Pending approval</Tag>} />
        </div>
      )}
      {s.step === 'approve' && <Done icon={ThumbsUp} title="Approve return" copy="A reverse-pickup is booked with Delhivery and the customer gets the label by email." done={st >= 1} onAction={() => setSt(1)} actionLabel="Approve" doneLabel="Approved" action={<Tag tone="ok">Reverse AWB booked</Tag>} />}
      {s.step === 'receive' && <Done icon={PackageCheck} title="Item back at warehouse" copy="Inspect and restock — the unit goes straight back to inventory." done={st >= 2} onAction={() => setSt(2)} actionLabel="Mark received" doneLabel="Received · restocked" action={<Tag tone="ok">+1 NS-HD-01-BLK</Tag>} />}
      {s.step === 'refund' && <Done icon={Wallet} title={`Refund ${rs(3199)}`} copy="Refunds go back to the original payment method through Razorpay; COD returns go to the customer's bank." done={st >= 3} onAction={() => setSt(3)} actionLabel="Issue refund" doneLabel="Refunded" action={<Tag tone="ok">Ledger entry posted</Tag>} />}
    </AppDemoShell>
  )
}
