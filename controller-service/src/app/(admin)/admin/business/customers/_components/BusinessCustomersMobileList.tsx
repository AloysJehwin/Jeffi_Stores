'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[status] || ''}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted flex-shrink-0">{label}</span>
      <span className={`text-sm text-foreground text-right break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function BusinessCustomersMobileList({ customers }: { customers: BusinessCustomerItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<BusinessCustomerItem | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (customers.length === 0) {
    return (
      <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
        No business customers found.
      </div>
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
            <StatusBadge status={c.approval_status} />
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
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
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
            <Field label="Status" value={<StatusBadge status={selected.approval_status} />} />
            <Field label="Joined" value={joined(selected.created_at)} />
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
