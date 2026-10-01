'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import PurgeCustomerButton from '@/components/admin/ecom/PurgeCustomerButton'

interface CustomerTenant {
  id: string
  slug: string
  display_name: string
  plan: string | null
  monthly_price_inr: number | string | null
  daily_payout: boolean | null
  status: string
  created_at: string
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted">{label}</span>
      <span className="text-sm text-foreground text-right">{value}</span>
    </div>
  )
}

export default function EcomCustomersMobileList({ tenants }: { tenants: CustomerTenant[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<CustomerTenant | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (tenants.length === 0) {
    return (
      <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
        No tenants match.
      </div>
    )
  }

  const price = (t: CustomerTenant) =>
    (t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—') +
    (t.daily_payout ? ' +daily' : '')

  const purgeable = (t: CustomerTenant) => t.status === 'terminated' || t.status === 'deprovisioned'

  const actions = (t: CustomerTenant): MobileAction[] => [
    { key: 'view', label: 'View store', onSelect: () => router.push(`/admin/ecom/customers/${t.id}?tab=overview`) },
  ]

  return (
    <div className="space-y-3">
      {tenants.map(t => (
        <MobileListCard key={t.id} ariaLabel={`Open ${t.display_name}`} onTap={() => setSelected(t)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{t.display_name}</p>
              <p className="text-xs text-foreground-muted truncate mt-0.5">{t.slug}.jeffistores.in</p>
            </div>
            <StatusPill status={t.status} />
          </div>
          <div className="mt-2 text-xs text-foreground-secondary capitalize">
            {t.plan || '—'} · {price(t)}
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.display_name}
        subtitle={selected ? `${selected.slug}.jeffistores.in` : undefined}
        footer={
          selected && purgeable(selected) ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setActionsOpen(true)}
                className="flex-1 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
              >
                Actions
              </button>
              <PurgeCustomerButton tenantId={selected.id} slug={selected.slug} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          )
        }
      >
        {selected && (
          <div className="px-5 py-3">
            <Field label="Subdomain" value={`${selected.slug}.jeffistores.in`} />
            <Field label="Plan" value={<span className="capitalize">{selected.plan || '—'}</span>} />
            <Field label="Price" value={price(selected)} />
            <Field label="Status" value={<StatusPill status={selected.status} />} />
            <Field label="Created" value={new Date(selected.created_at).toLocaleDateString('en-IN')} />
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
