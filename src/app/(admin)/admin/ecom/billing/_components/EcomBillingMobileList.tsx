'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { StatusPill } from '@/components/admin/ecom/EcomUI'

interface BillingTenant {
  id: string
  display_name: string
  plan: string | null
  monthly_price_inr: number | string | null
  daily_payout: boolean | null
  status: string
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted">{label}</span>
      <span className="text-sm text-foreground text-right">{value}</span>
    </div>
  )
}

export default function EcomBillingMobileList({ tenants }: { tenants: BillingTenant[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<BillingTenant | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (tenants.length === 0) {
    return (
      <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
        No tenants match.
      </div>
    )
  }

  const monthly = (t: BillingTenant) =>
    t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—'

  const actions = (t: BillingTenant): MobileAction[] => [
    { key: 'view', label: 'View ledger', onSelect: () => router.push(`/admin/ecom/billing/${t.id}`) },
  ]

  return (
    <div className="space-y-3">
      {tenants.map(t => (
        <MobileListCard key={t.id} ariaLabel={`Open ${t.display_name}`} onTap={() => setSelected(t)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{t.display_name}</p>
              <p className="text-xs text-foreground-muted capitalize mt-0.5">{t.plan || '—'}</p>
            </div>
            <StatusPill status={t.status} />
          </div>
          <div className="mt-2 text-xs text-foreground-secondary">
            {monthly(t)} / mo · {t.daily_payout ? 'Daily (+5%)' : 'Weekly'} payout
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.display_name}
        subtitle={selected?.plan ? <span className="capitalize">{selected.plan}</span> : undefined}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="px-5 py-3">
            <Field label="Plan" value={<span className="capitalize">{selected.plan || '—'}</span>} />
            <Field label="Monthly" value={monthly(selected)} />
            <Field label="Payout" value={selected.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field label="Status" value={<StatusPill status={selected.status} />} />
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.display_name}
        actions={selected ? actions(selected) : []}
      />
    </div>
  )
}
