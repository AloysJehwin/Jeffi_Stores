'use client'

import { useState } from 'react'
import { Users, PenLine, Send, BarChart3 } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Tag, Stat, Table, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'audience', label: 'Audience', icon: Users },
  { id: 'compose', label: 'Compose', icon: PenLine },
  { id: 'send', label: 'Send', icon: Send },
  { id: 'results', label: 'Opens & orders', icon: BarChart3 },
]

export default function CampaignsDemo() {
  const s = useSteps(STEPS)
  const [sent, setSent] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - campaigns">
      {s.step === 'audience' && <div className="h-full max-w-md space-y-3"><Field label="Segment" value="Bought in last 90 days · no order in 30" hint="412 people" /><Field label="Channels" value="Email + WhatsApp" /><Field label="Exclude" value="Unsubscribed · open returns" /></div>}
      {s.step === 'compose' && <div className="h-full max-w-xl space-y-3"><Field label="Subject" value="Your festive 15% is waiting, {{first_name}}" /><Field label="Preview" value="Use FESTIVE15 before 31 Oct on textiles and lighting." /><div className="rounded-2xl org-peach p-4 text-sm">Hi Alex, the throws you loved are back — and FESTIVE15 takes 15% off until 31 Oct.</div></div>}
      {s.step === 'send' && <Done icon={Send} title="Send to 412 people" copy="Scheduled for 10:00 IST tomorrow. Sends throttle automatically to protect your sender reputation." done={sent} onAction={() => setSent(true)} actionLabel="Schedule send" doneLabel="Scheduled" action={<Tag tone="ok">Tomorrow 10:00</Tag>} />}
      {s.step === 'results' && <div className="h-full flex flex-col gap-4"><div className="grid grid-cols-4 gap-3"><Stat label="Delivered" value="98%" /><Stat label="Opened" value="46%" tone="accent" /><Stat label="Clicked" value="12%" /><Stat label="Orders" value={rs(38400)} /></div><Table cols={['Order', 'Customer', 'Channel', 'Value']} rows={[['#1057', 'Nisha R.', 'Email', rs(2499)], ['#1056', 'Dev P.', 'WhatsApp', rs(1198)]]} /></div>}
    </AppDemoShell>
  )
}
