'use client'

import { useState } from 'react'
import { Sparkles, MousePointerClick, Eye, Check } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Panel, Btn, Table, Tag, Done, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'pick', label: 'Pick products', icon: MousePointerClick },
  { id: 'fill', label: 'AI fills the gaps', icon: Sparkles },
  { id: 'review', label: 'Review', icon: Eye },
  { id: 'apply', label: 'Apply', icon: Check },
]
const ITEMS = ['Linen throw', 'Oak tray', 'Jute rug']

export default function EnrichmentDemo() {
  const s = useSteps(STEPS)
  const [picked, setPicked] = useState<string[]>([ITEMS[0]])
  const [applied, setApplied] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - enrichment">
      {s.step === 'pick' && (
        <Panel title="Products missing descriptions">
          <ul className="space-y-2">{ITEMS.map(p => { const on = picked.includes(p); return <li key={p} className="flex items-center justify-between rounded-2xl bg-surface-elevated px-4 py-3"><span className="text-sm font-medium">{p}</span><Btn tone={on ? 'sand' : 'solid'} onClick={() => setPicked(a => on ? a.filter(x => x !== p) : [...a, p])}>{on ? 'Selected' : 'Select'}</Btn></li> })}</ul>
        </Panel>
      )}
      {s.step === 'fill' && (
        <Panel title={`Enriching ${picked.length} product${picked.length > 1 ? 's' : ''}`}>
          <Table cols={['Product', 'Description', 'SEO', 'Tags']} rows={picked.map(p => [p, <Tag key="d" tone="ok">Written</Tag>, <Tag key="s" tone="ok">Done</Tag>, <Tag key="t" tone="ok">6 added</Tag>])} />
        </Panel>
      )}
      {s.step === 'review' && (
        <div className="h-full max-w-xl space-y-3">
          <Field label="Linen throw · description" value="Stonewashed European linen in a relaxed weave — gets softer with every wash." />
          <Field label="SEO title" value="Linen Throw — Nova Shop" hint="24" />
          <Field label="Tags" value="linen · throw · living room · natural · gift" />
        </div>
      )}
      {s.step === 'apply' && (
        <Done icon={Check} title="Apply to catalogue" copy="Nothing changes until you apply. You can still edit any field afterwards." done={applied} onAction={() => setApplied(true)} actionLabel="Apply changes" doneLabel="Catalogue updated" action={<Tag tone="ok">{picked.length} products enriched</Tag>} />
      )}
    </AppDemoShell>
  )
}
