'use client'

import { useState } from 'react'
import { LayoutTemplate, ListChecks, CalendarClock, FileBarChart } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Tag, Stat, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'template', label: 'Template', icon: LayoutTemplate },
  { id: 'list', label: 'Pick list', icon: ListChecks },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'report', label: 'Report', icon: FileBarChart },
]

export default function MailerDemo() {
  const s = useSteps(STEPS)
  const [sch, setSch] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - mailer">
      {s.step === 'template' && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{['Newsletter', 'Product launch', 'Win-back'].map((t, i) => <div key={t} className={`rounded-2xl p-4 h-24 sm:h-40 flex flex-col justify-end ${i === 0 ? 'org-peach' : 'org-sand'}`}><span className="font-display font-black">{t}</span>{i === 0 && <Tag tone="warn">Selected</Tag>}</div>)}</div>}
      {s.step === 'list' && <div className="h-full max-w-md space-y-3"><Field label="List" value="All customers" hint="1,208" /><Field label="Minus" value="Unsubscribed" hint="−41" /><Field label="Sending to" value={<b>1,167</b>} /></div>}
      {s.step === 'schedule' && <Done icon={CalendarClock} title="October newsletter" copy="Pick a time or send now. Replies land in your inbox, bounces are handled for you." done={sch} onAction={() => setSch(true)} actionLabel="Schedule for Fri 09:00" doneLabel="Scheduled" action={<Tag tone="ok">Fri 09:00 IST</Tag>} />}
      {s.step === 'report' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Sent" value="1,167" /><Stat label="Opened" value="41%" tone="accent" /><Stat label="Clicked" value="9%" /><Stat label="Unsubscribed" value="0.3%" /></div>}
    </AppDemoShell>
  )
}
