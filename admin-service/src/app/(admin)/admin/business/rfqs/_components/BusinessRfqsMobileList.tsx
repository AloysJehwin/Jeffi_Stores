'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { StatusBadge } from '@/components/admin/kit/status'
import { RFQ_STATUS, fmtDay } from '../../_status'

interface RfqItem {
  id: string
  rfq_number: string
  status: string
  item_count: string
  created_at: string
  company_name: string | null
  first_name: string
  last_name: string | null
  email: string
  href: string
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-all">{value}</span>
    </div>
  )
}

export default function BusinessRfqsMobileList({ rfqs }: { rfqs: RfqItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<RfqItem | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (rfqs.length === 0) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-elevated p-8 text-center text-sm text-foreground-muted">No RFQs found.</div>
    )
  }

  const actions = (r: RfqItem): MobileAction[] => [
    { key: 'view', label: 'View RFQ', onSelect: () => router.push(r.href) },
  ]

  return (
    <div className="space-y-3">
      {rfqs.map(r => (
        <MobileListCard key={r.id} ariaLabel={`Open ${r.rfq_number}`} onTap={() => setSelected(r)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold text-foreground truncate">{r.rfq_number}</p>
              <p className="text-sm text-foreground truncate mt-0.5">{r.company_name || '—'}</p>
            </div>
            <StatusBadge status={r.status} map={RFQ_STATUS} />
          </div>
          <div className="mt-2 text-xs text-foreground-secondary">
            {r.item_count} items · {fmtDay(r.created_at)}
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.rfq_number}
        subtitle={selected?.company_name || undefined}
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
            <Field label="Company" value={selected.company_name || '—'} />
            <Field label="Contact" value={`${selected.first_name} ${selected.last_name || ''}`.trim()} />
            <Field label="Email" value={selected.email} />
            <Field label="Items" value={selected.item_count} />
            <Field label="Status" value={<StatusBadge status={selected.status} map={RFQ_STATUS} />} />
            <Field label="Submitted" value={fmtDay(selected.created_at)} />
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.rfq_number}
        actions={selected ? actions(selected) : []}
      />
    </div>
  )
}
