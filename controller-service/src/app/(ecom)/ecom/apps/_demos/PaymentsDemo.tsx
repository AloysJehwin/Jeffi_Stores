'use client'

import { CreditCard, CheckCircle2, Split, Landmark } from 'lucide-react'
import { AppDemoShell, useSteps, Table, Tag, Stat, Btn, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'checkout', label: 'Checkout', icon: CreditCard },
  { id: 'captured', label: 'Captured', icon: CheckCircle2 },
  { id: 'split', label: 'Fees split', icon: Split },
  { id: 'settled', label: 'Settled', icon: Landmark },
]

export default function PaymentsDemo() {
  const s = useSteps(STEPS)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption={s.step === 'checkout' ? 'novastore.jeffistores.in' : 'admin - payments'}>
      {s.step === 'checkout' && (
        <div className="h-full grid place-items-center">
          <div className="w-full max-w-sm rounded-[2rem] org-sand p-5 sm:p-6 space-y-4">
            <p className="font-display font-black text-xl">Pay {rs(2499)}</p>
            <div className="grid grid-cols-2 gap-2">{['UPI', 'Card', 'Netbanking', 'Cash on delivery'].map((m, i) => <span key={m} className={`rounded-full px-3 py-2 text-sm text-center ${i === 0 ? 'ecom-accent-bg text-white' : 'bg-surface-elevated'}`}>{m}</span>)}</div>
            <Btn>Pay with UPI</Btn>
          </div>
        </div>
      )}
      {s.step === 'captured' && <Table cols={['Payment', 'Order', 'Method', 'Amount', 'Status']} rows={[['pay_Nx82…', '#1043', 'UPI', rs(2499), <Tag key="t" tone="ok">Captured</Tag>], ['cod', '#1042', 'COD', rs(1198), <Tag key="t" tone="warn">On delivery</Tag>]]} />}
      {s.step === 'split' && (
        <div className="h-full flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1"><Stat label="Gross" value={rs(2499)} /><Stat label="Gateway fee" value={rs(49)} /><Stat label="Your share" value={rs(2450)} tone="accent" /></div>
          <p className="text-sm text-foreground-secondary">Razorpay Route splits every capture automatically — nothing to reconcile by hand.</p>
        </div>
      )}
      {s.step === 'settled' && <Table cols={['Settlement', 'Period', 'Amount', 'To', 'Status']} rows={[['setl_01', '7–9 Oct', rs(18240), 'HDFC ••4421', <Tag key="t" tone="ok">Paid</Tag>], ['setl_02', '10–12 Oct', rs(9310), 'HDFC ••4421', <Tag key="t" tone="warn">T+2</Tag>]]} />}
    </AppDemoShell>
  )
}
