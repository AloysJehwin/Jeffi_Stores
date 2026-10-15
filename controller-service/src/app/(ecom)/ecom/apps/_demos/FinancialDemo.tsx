'use client'

import { useState } from 'react'
import { Wallet, Hourglass, LineChart, Download } from 'lucide-react'
import { AppDemoShell, useSteps, Table, Tag, Stat, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'recv', label: 'Receivables', icon: Wallet },
  { id: 'ageing', label: 'Ageing', icon: Hourglass },
  { id: 'pl', label: 'P&L', icon: LineChart },
  { id: 'export', label: 'Export', icon: Download },
]

export default function FinancialDemo() {
  const s = useSteps(STEPS)
  const [exp, setExp] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - financial">
      {s.step === 'recv' && <Table cols={['Customer', 'Invoice', 'Due', 'Amount', 'Status']} rows={[['Meridian Cafés', 'INV-0177', '28 Oct', rs(46816), <Tag key="t" tone="warn">Due in 16d</Tag>], ['Blue Door Studio', 'INV-0171', '2 Oct', rs(12400), <Tag key="t" tone="bad">Overdue 10d</Tag>]]} />}
      {s.step === 'ageing' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Current" value={rs(46816)} /><Stat label="1–30 days" value={rs(12400)} tone="accent" /><Stat label="31–60" value={rs(0)} /><Stat label="60+" value={rs(0)} /></div>}
      {s.step === 'pl' && <Table cols={['October', 'Amount']} rows={[['Sales', rs(184200)], ['COGS', '−' + rs(91300)], ['Gateway + platform fees', '−' + rs(4120)], ['Shipping', '−' + rs(8900)], [<b key="n">Net</b>, <b key="v">{rs(79880)}</b>]]} />}
      {s.step === 'export' && <Done icon={Download} title="Export for your accountant" copy="Tally-ready XML or a plain CSV, with GST columns included." done={exp} onAction={() => setExp(true)} actionLabel="Export October" doneLabel="Exported" action={<Tag tone="ok">october-2024.xlsx</Tag>} />}
    </AppDemoShell>
  )
}
