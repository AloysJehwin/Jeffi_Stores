'use client'

import { useState } from 'react'
import { MessageSquare, ListTree, Play, CheckCircle2 } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Tag, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'ask', label: 'Ask', icon: MessageSquare },
  { id: 'plan', label: 'Plan', icon: ListTree },
  { id: 'run', label: 'Execute', icon: Play },
  { id: 'result', label: 'Result', icon: CheckCircle2 },
]
const PLAN = ['Find products with stock ≤ minimum', 'Group by supplier', 'Draft one PO per supplier', 'Ask you to approve before sending']

export default function AgentDemo() {
  const s = useSteps(STEPS)
  const [ran, setRan] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - agent">
      {s.step === 'ask' && <div className="h-full max-w-lg space-y-3 text-sm"><div className="rounded-2xl org-peach ml-16 px-4 py-3">Reorder everything that&apos;s low on stock, but let me approve first.</div><div className="rounded-2xl org-sand mr-16 px-4 py-3">On it — I&apos;ll put a plan together.</div></div>}
      {s.step === 'plan' && <ol className="h-full max-w-md space-y-2">{PLAN.map((p, i) => <li key={p} className="flex items-center gap-3 rounded-2xl bg-surface-elevated px-4 py-3 text-sm"><span className="org-sage org-sage-text grid place-items-center w-7 h-7 rounded-full text-xs font-bold">{i + 1}</span>{p}</li>)}</ol>}
      {s.step === 'run' && <Done icon={Play} title="Run the plan" copy="The agent only drafts; nothing is sent to suppliers until you approve." done={ran} onAction={() => setRan(true)} actionLabel="Run" doneLabel="2 POs drafted" action={<Tag tone="ok">Kiln & Co. · Loom Works</Tag>} />}
      {s.step === 'result' && <div className="h-full max-w-md space-y-3">{[['PO-0032 · Kiln & Co.', '24 × Clay mug set'], ['PO-0033 · Loom Works', '12 × Linen throw']].map(([a, b]) => <div key={a} className="flex items-center justify-between rounded-2xl org-sand px-4 py-3 text-sm"><span><b>{a}</b><br /><span className="text-foreground-secondary">{b}</span></span><Tag tone="warn">Awaiting approval</Tag></div>)}</div>}
    </AppDemoShell>
  )
}
