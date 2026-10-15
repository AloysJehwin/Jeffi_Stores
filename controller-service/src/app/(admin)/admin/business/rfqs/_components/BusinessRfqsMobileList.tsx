'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  negotiating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  offer_accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted: 'Converted',
  rejected: 'Rejected',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[status] || 'bg-surface-secondary text-foreground-secondary'}`}
    >
      {STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-all">{value}</span>
    </div>
  )
}

const submitted = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function BusinessRfqsMobileList({ rfqs }: { rfqs: RfqItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<RfqItem | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (rfqs.length === 0) {
    return (
      <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
        No RFQs found.
      </div>
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
            <StatusBadge status={r.status} />
          </div>
          <div className="mt-2 text-xs text-foreground-secondary">
            {r.item_count} items · {submitted(r.created_at)}
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
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
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
            <Field label="Status" value={<StatusBadge status={selected.status} />} />
            <Field label="Submitted" value={submitted(selected.created_at)} />
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
