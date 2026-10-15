'use client'

import { useState } from 'react'
import { Link2, ImagePlus, CalendarClock, Heart } from 'lucide-react'
import { AppDemoShell, useSteps, Done, Tag, Stat, Field, type DemoStep } from './kit'
import ProductArt from '@/app/(ecom)/ecom/_demo/ProductArt'

const STEPS: DemoStep[] = [
  { id: 'connect', label: 'Connect accounts', icon: Link2 },
  { id: 'post', label: 'Create post', icon: ImagePlus },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'engage', label: 'Engagement', icon: Heart },
]

export default function SocialDemo() {
  const s = useSteps(STEPS)
  const [c, setC] = useState(false)
  const [sch, setSch] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - social">
      {s.step === 'connect' && <Done icon={Link2} title="Connect Instagram & Facebook" copy="One login links your shop pages so products can be posted straight from the catalogue." done={c} onAction={() => setC(true)} actionLabel="Connect" doneLabel="Connected" action={<Tag tone="ok">@novashop · Nova Shop page</Tag>} />}
      {s.step === 'post' && <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="rounded-2xl org-peach grid place-items-center"><ProductArt category="Electronics" className="w-32 h-32" /></div><div className="space-y-3"><Field label="Caption" value="Studio sound, all-week battery. Wireless Headphones now ₹2,499." /><Field label="Link" value="/products/wireless-headphones" /><Field label="Hashtags" value="#novashop #audio" /></div></div>}
      {s.step === 'schedule' && <Done icon={CalendarClock} title="Post to both" copy="Best time suggested from your followers' activity." done={sch} onAction={() => setSch(true)} actionLabel="Schedule Sat 19:00" doneLabel="Scheduled" action={<Tag tone="ok">Instagram + Facebook</Tag>} />}
      {s.step === 'engage' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Reach" value="8.4k" /><Stat label="Likes" value="612" tone="accent" /><Stat label="Clicks" value="233" /><Stat label="Orders" value={14} /></div>}
    </AppDemoShell>
  )
}
