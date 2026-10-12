'use client'

import { Users, Globe, FileText, Target } from 'lucide-react'
import { AppDemoShell, useSteps, Table, Stat, Progress, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'visitors', label: 'Visitors', icon: Users },
  { id: 'sources', label: 'Sources', icon: Globe },
  { id: 'pages', label: 'Top pages', icon: FileText },
  { id: 'conv', label: 'Conversions', icon: Target },
]

export default function TrafficDemo() {
  const s = useSteps(STEPS)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - traffic">
      {s.step === 'visitors' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Today" value="1,284" tone="accent" /><Stat label="7 days" value="8,910" /><Stat label="Mobile" value="71%" /><Stat label="Bounce" value="34%" /></div>}
      {s.step === 'sources' && <div className="h-full max-w-md space-y-4">{[['Instagram', 42], ['Google', 31], ['Direct', 18], ['WhatsApp', 9]].map(([n, v]) => <div key={n}><div className="flex justify-between text-sm mb-1"><span>{n}</span><span className="text-foreground-muted">{v}%</span></div><Progress value={v as number} /></div>)}</div>}
      {s.step === 'pages' && <Table cols={['Page', 'Views', 'Avg time']} rows={[['/products/wireless-headphones', '2,104', '1:48'], ['/', '1,870', '0:52'], ['/collections/audio', '934', '1:12']]} />}
      {s.step === 'conv' && <div className="h-full max-w-md space-y-4">{[['Visited', 100], ['Viewed product', 61], ['Added to cart', 14], ['Paid', 3.2]].map(([n, v]) => <div key={n}><div className="flex justify-between text-sm mb-1"><span>{n}</span><span className="text-foreground-muted">{v}%</span></div><Progress value={v as number} /></div>)}</div>}
    </AppDemoShell>
  )
}
