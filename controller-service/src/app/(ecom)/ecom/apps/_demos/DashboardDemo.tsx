'use client'

import { IndianRupee, ShoppingBag, AlertTriangle, TrendingUp } from 'lucide-react'
import { AppDemoShell, useSteps, Tag, Table, Stat, rs, type DemoStep } from './kit'

const STEPS: DemoStep[] = [
  { id: 'revenue', label: 'Revenue', icon: IndianRupee },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'attention', label: 'Needs attention', icon: AlertTriangle },
  { id: 'trend', label: 'Trend', icon: TrendingUp },
]
const BARS = [38, 52, 44, 61, 58, 74, 69, 83, 77, 91, 88, 96]

export default function DashboardDemo() {
  const s = useSteps(STEPS)
  return (
    <AppDemoShell steps={STEPS} step={s.step} onStep={s.go} caption="admin - dashboard">
      {s.step === 'revenue' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Stat label="Today" value={rs(18240)} tone="accent" /><Stat label="This month" value={rs(184200)} /><Stat label="AOV" value={rs(2160)} /><Stat label="Gross margin" value="38%" /></div>}
      {s.step === 'orders' && <Table cols={['Order', 'Customer', 'Total', 'Status']} rows={[['#1043', 'Alex Morgan', rs(2499), <Tag key="t" tone="warn">New</Tag>], ['#1042', 'Priya S.', rs(1198), <Tag key="t" tone="neutral">Processing</Tag>], ['#1041', 'Rahul K.', rs(3199), <Tag key="t" tone="ok">Delivered</Tag>]]} />}
      {s.step === 'attention' && <div className="h-full max-w-md space-y-3">{[['1 order pending > 24h', 'warn'], ['2 products low / out of stock', 'bad'], ['1 open return', 'warn'], ['GSTR-1 due in 6 days', 'neutral']].map(([t, tone]) => <div key={t} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated px-4 py-3 text-sm"><span className="min-w-0">{t}</span><Tag tone={tone as 'warn'}>Open</Tag></div>)}</div>}
      {s.step === 'trend' && <div className="h-72 sm:h-full flex flex-col"><p className="text-sm text-foreground-secondary mb-3">Revenue · last 12 weeks</p><div className="flex-1 flex items-end gap-1.5 sm:gap-2">{BARS.map((h, i) => <div key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%`, background: i === BARS.length - 1 ? 'var(--org-terracotta)' : i % 2 ? 'var(--org-apricot)' : 'var(--org-peach)' }} />)}</div></div>}
    </AppDemoShell>
  )
}
