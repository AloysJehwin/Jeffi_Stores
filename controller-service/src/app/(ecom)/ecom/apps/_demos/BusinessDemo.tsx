'use client'

import { useState } from 'react'
import { Building2, ShieldCheck, Tags, ShoppingBag } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Tag, Table, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'apply', label: 'Buyer applies', icon: Building2 },
  { id: 'approve', label: 'Approve', icon: ShieldCheck },
  { id: 'pricing', label: 'GST pricing', icon: Tags },
  { id: 'order', label: 'First order', icon: ShoppingBag },
]

export default function BusinessDemo() {
  const s = useSteps(STEPS)
  const [ok, setOk] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'apply' ? 'novastore.business' : 'admin - business accounts'}>
      {s.step === 'apply' && <div className="h-full max-w-md space-y-3"><Field label="Business" value="Meridian Cafés Pvt Ltd" /><Field label="GSTIN" value="33AADCM4321K1ZP" /><Field label="Contact" value="procurement@meridian.cafe" /><Field label="Status" value={<Tag tone="warn">Pending approval</Tag>} /></div>}
      {s.step === 'approve' && <Done icon={ShieldCheck} title="Approve Meridian Cafés" copy="GSTIN is verified against the GSTN registry. Approved buyers see wholesale prices after login." done={ok} onAction={() => setOk(true)} actionLabel="Approve" doneLabel="Approved" action={<Tag tone="ok">Welcome email sent</Tag>} />}
      {s.step === 'pricing' && <Table cols={['Product', 'Retail', 'Wholesale', 'MOQ']} rows={[['Clay mug set', rs(899), rs(760), 20], ['Stoneware plate', rs(249), rs(190), 50]]} />}
      {s.step === 'order' && <Table cols={['Order', 'Buyer', 'Lines', 'Total', 'Invoice']} rows={[['#1060', 'Meridian Cafés', 2, rs(46816), <Tag key="t" tone="ok">B2B tax invoice</Tag>]]} />}
    </AppDemoShell>
  )
}
