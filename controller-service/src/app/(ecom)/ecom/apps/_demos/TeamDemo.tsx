'use client'

import { useState } from 'react'
import { UserPlus, Shield, KeyRound, Activity } from 'lucide-react'
import { AppDemoShell, useSteps, Field, Done, Tag, Table, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'invite', label: 'Invite', icon: UserPlus },
  { id: 'roles', label: 'Roles', icon: Shield },
  { id: 'scopes', label: 'Scopes', icon: KeyRound },
  { id: 'activity', label: 'Activity', icon: Activity },
]

export default function TeamDemo() {
  const s = useSteps(STEPS)
  const [sent, setSent] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - team">
      {s.step === 'invite' && <Done icon={UserPlus} title="Invite priya@novashop.in" copy="They sign in with a one-time code; no passwords to manage." done={sent} onAction={() => setSent(true)} actionLabel="Send invite" doneLabel="Invited" action={<Tag tone="warn">Pending</Tag>} />}
      {s.step === 'roles' && <Table cols={['Member', 'Role', 'Status']} rows={[['You', <Tag key="t" tone="ok">Owner</Tag>, 'Active'], ['Priya S.', <Tag key="t" tone="neutral">Operations</Tag>, sent ? 'Invited' : '—'], ['Dev P.', <Tag key="t" tone="neutral">Support</Tag>, 'Active']]} />}
      {s.step === 'scopes' && <div className="h-full max-w-md space-y-3"><Field label="Operations can" value="orders:write · inventory:write · shipments:write" /><Field label="Operations cannot" value="billing · payouts · team" /><Field label="Support can" value="orders:read · customers:read · returns:write" /></div>}
      {s.step === 'activity' && <Table cols={['When', 'Who', 'Action']} rows={[['10:12', 'Priya S.', 'Confirmed order #1043'], ['09:48', 'Dev P.', 'Approved return RT-07'], ['Yesterday', 'You', 'Changed plan to Pro']]} />}
    </AppDemoShell>
  )
}
