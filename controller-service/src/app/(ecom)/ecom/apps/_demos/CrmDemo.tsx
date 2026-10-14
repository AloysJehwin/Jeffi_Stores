'use client'

import { useState } from 'react'
import { User, HeartPulse, Users, Zap } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Tag, Table, Stat, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'customer', label: 'Customer', icon: User },
  { id: 'health', label: 'Health score', icon: HeartPulse },
  { id: 'segment', label: 'Segment', icon: Users },
  { id: 'action', label: 'Take action', icon: Zap },
]

export default function CrmDemo() {
  const s = useSteps(STEPS)
  const [done, setDone] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - crm">
      {s.step === 'customer' && <div className="h-full max-w-md space-y-3"><Field label="Name" value="Alex Morgan" /><Field label="Orders" value="6 · last 12 days ago" /><Field label="Lifetime value" value={rs(14230)} /><Field label="Channels" value="Email · WhatsApp" /></div>}
      {s.step === 'health' && <div className="h-full flex flex-col gap-4"><div className="grid grid-cols-3 gap-3"><Stat label="Health" value="82" tone="accent" /><Stat label="Recency" value="12d" /><Stat label="Frequency" value="6" /></div><p className="text-sm text-foreground-secondary max-w-md">Scored from recency, frequency and value. Drops below 50 trigger a win-back automatically.</p></div>}
      {s.step === 'segment' && <Table cols={['Segment', 'Customers', 'Avg LTV', 'Health']} rows={[['Champions', 48, rs(12800), <Tag key="t" tone="ok">High</Tag>], ['Loyal', 131, rs(6100), <Tag key="t" tone="ok">Good</Tag>], ['At risk', 64, rs(3900), <Tag key="t" tone="warn">Low</Tag>], ['Lost', 207, rs(1400), <Tag key="t" tone="bad">Churned</Tag>]]} />}
      {s.step === 'action' && <Done icon={Zap} title="Win back 64 at-risk customers" copy="Enroll the segment in the win-back journey: email on day 0, WhatsApp on day 3 with a 10% code." done={done} onAction={() => setDone(true)} actionLabel="Start journey" doneLabel="Journey started" action={<Tag tone="ok">64 enrolled</Tag>} />}
    </AppDemoShell>
  )
}
