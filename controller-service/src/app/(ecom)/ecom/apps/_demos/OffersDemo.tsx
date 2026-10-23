'use client'

import { useState } from 'react'
import { BadgePercent, MousePointerClick, CalendarClock, Store } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Panel, Btn, Tag, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'create', label: 'Create offer', icon: BadgePercent },
  { id: 'pick', label: 'Pick products', icon: MousePointerClick },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'live', label: 'Live badge', icon: Store },
]
const ITEMS = ['Linen throw', 'Jute rug', 'Cotton napkins']

export default function OffersDemo() {
  const s = useSteps(STEPS)
  const [picked, setPicked] = useState<string[]>([ITEMS[0]])
  const [live, setLive] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'live' ? 'novastore.jeffistores.in' : 'admin - offers'}>
      {s.step === 'create' && <div className="h-full max-w-md space-y-3"><Field label="Offer" value="Festive textiles" /><Field label="Discount" value="20% off" /><Field label="Badge text" value="Festive −20%" /></div>}
      {s.step === 'pick' && <Panel title="Products in offer"><ul className="space-y-2">{ITEMS.map(p => { const on = picked.includes(p); return <li key={p} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated px-3 py-3 sm:px-4"><span className="min-w-0 text-sm font-medium">{p}</span><Btn tone={on ? 'sand' : 'solid'} onClick={() => setPicked(a => on ? a.filter(x => x !== p) : [...a, p])}>{on ? 'In offer' : 'Add'}</Btn></li> })}</ul></Panel>}
      {s.step === 'schedule' && <Done icon={CalendarClock} title="12 – 31 Oct" copy="Prices switch automatically at midnight on both dates; no manual edits." done={live} onAction={() => setLive(true)} actionLabel="Publish offer" doneLabel="Scheduled" action={<Tag tone="ok">{picked.length} products</Tag>} />}
      {s.step === 'live' && <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{picked.map(p => <div key={p} className="rounded-2xl org-sand p-3 relative"><Tag tone="warn">Festive −20%</Tag><div className="aspect-square rounded-xl org-peach my-2" /><p className="text-xs font-medium truncate">{p}</p><p className="text-xs"><b>{rs(959)}</b> <s className="opacity-60">{rs(1199)}</s></p></div>)}</div>}
    </AppDemoShell>
  )
}
