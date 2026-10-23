'use client'

import { useState } from 'react'
import { ScanLine, ShoppingCart, Banknote, ReceiptText } from 'lucide-react'
import { AppDemoShell, useSteps, Panel, Btn, Table, Tag, Done, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'scan', label: 'Scan items', icon: ScanLine },
  { id: 'cart', label: 'Cart', icon: ShoppingCart },
  { id: 'collect', label: 'Collect payment', icon: Banknote },
  { id: 'receipt', label: 'Receipt', icon: ReceiptText },
]
const ITEMS = [['Clay mug set', 899], ['Cotton napkins', 499], ['Oak tray', 1499]] as const

export default function CashSaleDemo() {
  const s = useSteps(STEPS)
  const [n, setN] = useState(1)
  const [paid, setPaid] = useState(false)
  const total = ITEMS.slice(0, n).reduce((a, [, p]) => a + p, 0)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - cash sale">
      {s.step === 'scan' && (
        <Panel title="Counter sale" action={<Btn onClick={() => setN(x => Math.min(3, x + 1))} disabled={n >= 3}><ScanLine className="w-3.5 h-3.5" /> Scan next</Btn>}>
          <div className="h-full grid place-items-center"><div className="rounded-[2rem] org-sand w-48 h-48 sm:w-64 sm:h-64 grid place-items-center"><span className="font-display font-black text-5xl">{n}</span></div></div>
        </Panel>
      )}
      {s.step === 'cart' && (
        <Panel title="Cart">
          <Table cols={['Item', 'Qty', 'Price']} rows={[...ITEMS.slice(0, n).map(([i, p]) => [i, 1, rs(p)]), [<b key="t">Total</b>, '', <b key="v">{rs(total)}</b>]]} />
        </Panel>
      )}
      {s.step === 'collect' && (
        <Done icon={Banknote} title={`Collect ${rs(total)}`} copy="Cash, UPI QR or card — the sale posts to the same ledger as online orders." done={paid} onAction={() => setPaid(true)} actionLabel="Cash received" doneLabel="Paid in cash" action={<Tag tone="ok">Stock deducted</Tag>} />
      )}
      {s.step === 'receipt' && (
        <div className="h-full grid place-items-center">
          <div className="w-full max-w-72 sm:w-72 rounded-2xl bg-surface-elevated p-5 font-mono text-xs space-y-1">
            <p className="font-display font-black text-base font-sans">Nova Shop</p>
            <p className="text-foreground-muted">GSTIN 33AABCN0001A1Z9</p>
            <hr className="my-2 border-border-default" />
            {ITEMS.slice(0, n).map(([i, p]) => <p key={i} className="flex justify-between gap-3"><span>{i}</span><span>{rs(p)}</span></p>)}
            <hr className="my-2 border-border-default" />
            <p className="flex justify-between font-bold"><span>Total</span><span>{rs(total)}</span></p>
            <p className="text-foreground-muted">incl. GST · Receipt CS-0088</p>
          </div>
        </div>
      )}
    </AppDemoShell>
  )
}
