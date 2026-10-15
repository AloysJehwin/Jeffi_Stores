'use client'

import { useState } from 'react'
import { Landmark, ShieldCheck, CalendarClock, Banknote } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Table, Tag, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'bank', label: 'Bank account', icon: Landmark },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'paid', label: 'Paid out', icon: Banknote },
]

export default function PayoutsDemo() {
  const s = useSteps(STEPS)
  const [v, setV] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="dashboard - payouts">
      {s.step === 'bank' && <div className="h-full max-w-md space-y-3"><Field label="Account holder" value="Nova Retail LLP" /><Field label="Account number" value="•••• •••• 4421" /><Field label="IFSC" value="HDFC0001234" /></div>}
      {s.step === 'verify' && <Done icon={ShieldCheck} title="Penny-drop verification" copy="We send ₹1 and match the account name with the bank." done={v} onAction={() => setV(true)} actionLabel="Verify account" doneLabel="Verified" action={<Tag tone="ok">Name matched · NOVA RETAIL LLP</Tag>} />}
      {s.step === 'schedule' && <div className="h-full max-w-md space-y-3"><Field label="Payout cycle" value="Daily (T+2)" /><Field label="Minimum payout" value={rs(500)} /><Field label="COD remittance" value="Weekly, Fridays" /></div>}
      {s.step === 'paid' && <Table cols={['Date', 'Amount', 'Reference', 'Status']} rows={[['12 Oct', rs(9310), 'UTR 4123…', <Tag key="t" tone="ok">Paid</Tag>], ['11 Oct', rs(6480), 'UTR 4098…', <Tag key="t" tone="ok">Paid</Tag>], ['13 Oct', rs(2450), '—', <Tag key="t" tone="warn">Scheduled</Tag>]]} />}
    </AppDemoShell>
  )
}
