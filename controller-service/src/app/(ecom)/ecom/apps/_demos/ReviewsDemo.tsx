'use client'

import { useState } from 'react'
import { MailCheck, Star, ShieldCheck, Store } from 'lucide-react'
import { AppDemoShell, useSteps, Panel, Btn, Table, Tag, Done, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'request', label: 'Request review', icon: MailCheck },
  { id: 'rate', label: 'Customer rates', icon: Star },
  { id: 'moderate', label: 'Moderate', icon: ShieldCheck },
  { id: 'pdp', label: 'Shows on product', icon: Store },
]
const Stars = ({ n }: { n: number }) => <span className="ecom-accent-text tracking-tight">{'★'.repeat(n)}<span className="opacity-30">{'★'.repeat(5 - n)}</span></span>

export default function ReviewsDemo() {
  const s = useSteps(STEPS)
  const [sent, setSent] = useState(false)
  const [approved, setApproved] = useState(false)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'pdp' ? 'novastore.jeffistores.in' : 'admin - reviews'}>
      {s.step === 'request' && (
        <Done icon={MailCheck} title="Order #1043 delivered 3 days ago" copy="Send a one-tap review request by email and WhatsApp." done={sent} onAction={() => setSent(true)} actionLabel="Send request" doneLabel="Request sent" action={<Tag tone="ok">Opened</Tag>} />
      )}
      {s.step === 'rate' && (
        <div className="h-full grid place-items-center">
          <div className="max-w-sm w-full rounded-[2rem] org-sand p-6">
            <p className="text-xs text-foreground-muted">Alex Morgan · Wireless Headphones</p>
            <p className="text-2xl mt-2"><Stars n={5} /></p>
            <p className="text-sm text-foreground mt-3">“Battery lasts the whole week and they sound warm. Shipping was quick.”</p>
          </div>
        </div>
      )}
      {s.step === 'moderate' && (
        <Panel title="Pending reviews" action={<Btn onClick={() => setApproved(true)} disabled={approved}>{approved ? 'Approved' : 'Approve'}</Btn>}>
          <Table cols={['Customer', 'Product', 'Rating', 'Status']} rows={[['Alex Morgan', 'Wireless Headphones', <Stars key="s" n={5} />, <Tag key="t" tone={approved ? 'ok' : 'warn'}>{approved ? 'Published' : 'Pending'}</Tag>], ['Priya S.', 'Clay mug set', <Stars key="s" n={4} />, <Tag key="t" tone="ok">Published</Tag>]]} />
        </Panel>
      )}
      {s.step === 'pdp' && (
        <div className="h-full max-w-md space-y-3">
          <p className="font-display font-black text-2xl">Wireless Headphones</p>
          <p className="text-sm"><Stars n={5} /> <span className="text-foreground-muted">4.8 · 23 reviews</span></p>
          <div className="rounded-2xl bg-surface-elevated p-4 text-sm"><p className="font-semibold">Alex Morgan <Tag tone="ok">Verified</Tag></p><p className="mt-1 text-foreground-secondary">Battery lasts the whole week and they sound warm.</p></div>
        </div>
      )}
    </AppDemoShell>
  )
}
