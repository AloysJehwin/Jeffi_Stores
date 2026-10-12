'use client'

import { Layers, UserCheck, Eye } from 'lucide-react'
import { AppDemoShell, useSteps, Table, Tag, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'tiers', label: 'Price tiers', icon: Layers },
  { id: 'assign', label: 'Assign buyers', icon: UserCheck },
  { id: 'buyer', label: 'Buyer sees', icon: Eye },
]

export default function B2bPricingDemo() {
  const s = useSteps(STEPS)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'buyer' ? 'novastore.business' : 'admin - b2b pricing'}>
      {s.step === 'tiers' && <Table cols={['Tier', 'Discount', 'MOQ', 'Buyers']} rows={[['Retail', '—', 1, '—'], ['Wholesale', '15%', 20, 6], ['Distributor', '28%', 100, 2]]} />}
      {s.step === 'assign' && <Table cols={['Buyer', 'Tier', 'Since']} rows={[['Meridian Cafés', <Tag key="t" tone="warn">Wholesale</Tag>, 'Oct 2024'], ['Blue Door Studio', <Tag key="t" tone="ok">Distributor</Tag>, 'Aug 2024']]} />}
      {s.step === 'buyer' && <div className="h-full grid place-items-center"><div className="w-72 rounded-[2rem] org-sand p-5"><div className="aspect-square rounded-2xl org-peach mb-3" /><p className="font-display font-black">Brass lamp</p><p className="text-sm"><b>{rs(2300)}</b> <s className="opacity-60">{rs(3199)}</s> <Tag tone="ok">Distributor</Tag></p><p className="text-xs text-foreground-muted mt-1">MOQ 100 · excl. GST</p></div></div>}
    </AppDemoShell>
  )
}
