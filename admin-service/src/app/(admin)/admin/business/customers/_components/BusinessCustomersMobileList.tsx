'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { StatusBadge } from '@/components/admin/kit/status'
import { APPROVAL_STATUS, fmtDay } from '../../_status'

interface BusinessCustomerItem {
  user_id: string
  email: string
  first_name: string
  last_name: string | null
  company_name: string
  gst_number: string
  industry: string
  approval_status: string
  created_at: string
  href: string
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted flex-shrink-0">{label}</span>
      <span className={`text-sm text-foreground text-right break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

export default function BusinessCustomersMobileList({ customers }: { customers: BusinessCustomerItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<BusinessCustomerItem | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (customers.length === 0) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-elevated p-8 text-center text-sm text-foreground-muted">No business customers found.</div>
    )
  }

  const actions = (c: BusinessCustomerItem): MobileAction[] => [
    { key: 'view', label: 'View customer', onSelect: () => router.push(c.href) },
  ]

  return (
    <div className="space-y-3">
      {customers.map(c => (
        <MobileListCard key={c.user_id} ariaLabel={`Open ${c.company_name}`} onTap={() => setSelected(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{c.company_name}</p>
              <p className="text-xs text-foreground-muted truncate mt-0.5">
                {c.first_name} {c.last_name || ''}
              </p>
            </div>
            <StatusBadge status={c.approval_status} map={APPROVAL_STATUS} />
          </div>
          <div className="mt-2 text-xs text-foreground-secondary truncate">{c.email}</div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.company_name}
        subtitle={selected ? `${selected.first_name} ${selected.last_name || ''}`.trim() : undefined}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="control-md w-full bg-accent-500 font-semibold text-white hover:bg-accent-600"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="px-5 py-3">
            <Field label="Email" value={selected.email} />
            <Field label="GST" mono value={selected.gst_number} />
            <Field label="Industry" value={selected.industry} />
            <Field label="Status" value={<StatusBadge status={selected.approval_status} map={APPROVAL_STATUS} />} />
            <Field label="Joined" value={fmtDay(selected.created_at)} />
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.company_name}
        actions={selected ? actions(selected) : []}
      />
    </div>
  )
}
