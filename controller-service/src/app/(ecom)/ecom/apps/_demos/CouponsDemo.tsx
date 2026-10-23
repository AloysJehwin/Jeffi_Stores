'use client'

import { useState } from 'react'
import { TicketPercent, SlidersHorizontal, Radio, BarChart3 } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Panel, Tag, Stat, Done, Progress, Table, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'create', label: 'Create code', icon: TicketPercent },
  { id: 'rules', label: 'Rules', icon: SlidersHorizontal },
  { id: 'live', label: 'Go live', icon: Radio },
  { id: 'stats', label: 'Redemptions', icon: BarChart3 },
]

export default function CouponsDemo() {
  const s = useSteps(STEPS)
  const [live, setLive] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - coupons">
      {s.step === 'create' && (
        <div className="h-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
          <div className="sm:col-span-2"><Field label="Code" value="FESTIVE15" /></div>
          <Field label="Type" value="15% off" /><Field label="Max discount" value={rs(500)} />
        </div>
      )}
      {s.step === 'rules' && (
        <div className="h-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
          <Field label="Minimum cart" value={rs(999)} /><Field label="Usage cap" value="200" />
          <Field label="Per customer" value="1" /><Field label="Valid" value="12–31 Oct" />
          <div className="sm:col-span-2"><Field label="Applies to" value="Textiles · Lighting" /></div>
        </div>
      )}
      {s.step === 'live' && (
        <Done icon={Radio} title="Publish FESTIVE15" copy="Live codes apply instantly at checkout and show on the storefront banner." done={live} onAction={() => setLive(true)} actionLabel="Go live" doneLabel="Live" action={<Tag tone="ok">Showing on storefront</Tag>} />
      )}
      {s.step === 'stats' && (
        <Panel title="FESTIVE15 · 7 days">
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1"><Stat label="Redeemed" value={86} tone="accent" /><Stat label="Orders" value={rs(1.4e5)} /><Stat label="Avg discount" value={rs(342)} /></div>
            <div><div className="flex justify-between text-xs text-foreground-muted mb-1"><span>86 / 200 used</span><span>43%</span></div><Progress value={43} /></div>
            <Table cols={['Order', 'Customer', 'Discount']} rows={[['#1051', 'Nisha R.', rs(375)], ['#1049', 'Dev P.', rs(500)]]} />
          </div>
        </Panel>
      )}
    </AppDemoShell>
  )
}
